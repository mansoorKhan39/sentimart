import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET variable is set.
export function requireCronSecret(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const expected = `Bearer ${env.CRON_SECRET}`;
  const same =
    env.CRON_SECRET &&
    header.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  if (!same) return next(new ApiError(401, 'UNAUTHENTICATED', 'Invalid cron secret'));
  return next();
}
