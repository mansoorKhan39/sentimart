import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// NOTE: the default store is in memory and per serverless instance, so this is a
// best-effort layer. The primary limit is the Vercel Firewall rate-limit rule;
// login lockout is stored in MongoDB (see auth.service.js).
const make = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many requests')),
  });

export const generalLimiter = make(60_000, env.RATE_LIMIT_GENERAL_PER_MIN);
export const authLimiter = make(15 * 60_000, 30);
