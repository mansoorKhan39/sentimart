import { z } from 'zod';
import { MAX_REPORT_DAYS, REPORT_RANGES } from '../config/constants.js';
import { DAY, startOfUtcDay } from '../utils/dates.js';
import { objectId } from './common.validators.js';

const rangeShape = {
  range: z.enum(Object.keys(REPORT_RANGES)).default('30d'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  interval: z.enum(['day', 'week', 'month']).optional(),
};

// from must not be after to, and the window may cover at most 366 days.
const checkRange = (q) => {
  if (q.from && q.to) {
    if (q.from > q.to) return false;
    const days = (startOfUtcDay(q.to).getTime() + DAY - startOfUtcDay(q.from).getTime()) / DAY;
    return days <= MAX_REPORT_DAYS;
  }
  return true;
};
const rangeError = { message: `Use from <= to and at most ${MAX_REPORT_DAYS} days`, path: ['from'] };
const withRange = (shape) => z.object(shape).refine(checkRange, rangeError);

export const salesQuery = { query: withRange(rangeShape) };
export const sentimentQuery = { query: withRange({ ...rangeShape, productId: objectId.optional() }) };
export const complaintsQuery = {
  query: withRange({
    ...rangeShape,
    productId: objectId.optional(),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  }),
};
export const exportQuery = {
  query: withRange({
    ...rangeShape,
    productId: objectId.optional(),
    type: z.enum(['sales', 'sentiment', 'complaints']),
  }),
};
export const reportQuery = { query: withRange(rangeShape) };
