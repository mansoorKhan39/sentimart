import { logger } from '../utils/logger.js';

const listeners = new Map();

export function on(event, fn) {
  listeners.set(event, [...(listeners.get(event) ?? []), fn]);
}

// Serverless note: a function can be frozen right after the response, so callers `await emit(...)`
// before replying. Listener errors are logged and never reach the caller (an email failure must
// not break the order, SRS AC-NOTIFY).
export async function emit(event, payload) {
  const results = await Promise.allSettled((listeners.get(event) ?? []).map((fn) => fn(payload)));
  for (const r of results) {
    if (r.status === 'rejected')
      logger.warn('event listener failed', { event, error: r.reason?.message });
  }
}
