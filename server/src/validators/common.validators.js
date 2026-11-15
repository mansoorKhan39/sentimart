import mongoose from 'mongoose';
import { z } from 'zod';

export const objectId = z
  .string()
  .refine(
    (v) => mongoose.isValidObjectId(v) && String(new mongoose.Types.ObjectId(v)) === v.toLowerCase(),
    'Invalid id',
  );

export const idParam = { params: z.object({ id: objectId }) };

// Shared by list endpoints: page >= 1, limit capped at 50 (SRS NFR page-size limit).
export const pageShape = (defaultLimit = 20) => ({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(defaultLimit)
    .transform((n) => Math.min(n, 50)),
});
