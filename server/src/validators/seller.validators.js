import { z } from 'zod';
import { SENTIMENT_LABELS } from '../config/constants.js';
import { objectId, pageShape } from './common.validators.js';

export const inventoryQuery = {
  query: z.object({
    q: z.string().trim().max(100).optional(),
    stock: z.enum(['all', 'low', 'out']).default('all'),
    ...pageShape(20),
  }),
};

export const sellerReviewsQuery = {
  query: z.object({
    sentiment: z.enum(SENTIMENT_LABELS).optional(),
    replied: z.enum(['true', 'false']).optional(),
    productId: objectId.optional(),
    ...pageShape(10),
  }),
};
