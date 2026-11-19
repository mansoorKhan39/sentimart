import { z } from 'zod';
import { MAX_CART_QTY } from '../config/constants.js';
import { objectId } from './common.validators.js';

export const productIdParam = { params: z.object({ productId: objectId }) };

export const setQuantitySchema = {
  params: z.object({ productId: objectId }),
  body: z.object({ qty: z.number().int().min(1).max(MAX_CART_QTY) }).strict(),
};
