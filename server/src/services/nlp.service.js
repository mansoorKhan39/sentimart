import { env } from '../config/env.js';
import { SENTIMENT_LABELS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Calls the FastAPI NLP service. Returns null when it is not configured, unreachable, slow or
// answers badly: the caller then keeps the review as "pending" and retries later (SRS FR-25).
export async function analyzeText({ text, rating }, { timeoutMs } = {}) {
  if (!env.NLP_URL || !env.NLP_API_KEY) return null;
  try {
    const res = await fetch(`${env.NLP_URL.replace(/\/+$/, '')}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': env.NLP_API_KEY },
      body: JSON.stringify({ text, rating }),
      signal: AbortSignal.timeout(timeoutMs ?? env.NLP_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn('nlp service rejected request', { status: res.status });
      return null;
    }
    const data = await res.json();
    if (!SENTIMENT_LABELS.includes(data.label) || !Number.isFinite(data.score)) {
      logger.warn('nlp service returned an unexpected response');
      return null;
    }
    return {
      label: data.label,
      score: Math.max(-1, Math.min(1, data.score)),
      keywords: Array.isArray(data.keywords) ? data.keywords.slice(0, 8).map(String) : [],
      spamScore: clamp01(Number(data.spam_score) || 0),
      spamReasons: Array.isArray(data.spam_reasons) ? data.spam_reasons.map(String) : [],
    };
  } catch (err) {
    logger.warn('nlp service unavailable', { error: err.message });
    return null;
  }
}
