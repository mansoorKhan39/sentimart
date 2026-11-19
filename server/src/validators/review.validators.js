import { z } from 'zod';
import {
  REVIEW_REPLY_MAX,
  REVIEW_TEXT_MAX,
  REVIEW_TEXT_MIN,
  SENTIMENT_LABELS,
} from '../config/constants.js';
import { objectId } from './common.validators.js';

const rating = z.number().int().min(1).max(5);
const text = z.string().trim().min(REVIEW_TEXT_MIN).max(REVIEW_TEXT_MAX);

export const createReviewSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ rating, text }).strict(),
};

export const updateReviewSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({ rating, text })
    .partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update'),
};

export const listReviewsSchema = {
  params: z.object({ id: objectId }),
  query: z.object({
    sentiment: z.enum(SENTIMENT_LABELS).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .default(10)
      .transform((n) => Math.min(n, 50)),
  }),
};

export const replySchema = {
  params: z.object({ id: objectId }),
  body: z.object({ text: z.string().trim().min(2).max(REVIEW_REPLY_MAX) }).strict(),
};
