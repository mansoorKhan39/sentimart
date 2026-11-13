import mongoose from 'mongoose';
import { z } from 'zod';

export const objectId = z
  .string()
  .refine(
    (v) => mongoose.isValidObjectId(v) && String(new mongoose.Types.ObjectId(v)) === v.toLowerCase(),
    'Invalid id',
  );

export const idParam = { params: z.object({ id: objectId }) };
