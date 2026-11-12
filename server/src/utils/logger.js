/* eslint-disable no-console */
import { env } from '../config/env.js';

const SENSITIVE = /password|token|secret|authorization|cookie|apikey/i;

function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 3) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1),
    ]),
  );
}

function write(level, msg, meta = {}) {
  if (env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...redact(meta) });
  (level === 'error' ? console.error : console.log)(line);
}

export const logger = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
