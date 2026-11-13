import { z } from 'zod';
import { MAX_PRICE, MAX_STOCK } from '../config/constants.js';
import { objectId } from './common.validators.js';

const title = z.string().trim().min(3).max(120);
const description = z.string().trim().min(10).max(4000);
const price = z.number().int().min(1).max(MAX_PRICE);
const stock = z.number().int().min(0).max(MAX_STOCK);
const categoryName = z.string().trim().min(2).max(50);

export const categoryBodySchema = { body: z.object({ name: categoryName }).strict() };
export const categoryUpdateSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ name: categoryName }).strict(),
};

export const createProductSchema = {
  body: z.object({ title, description, price, stock, categoryId: objectId }).strict(),
};

export const updateProductSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({ title, description, price, stock, categoryId: objectId })
    .partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update'),
};

export const productImageParams = {
  params: z.object({ id: objectId, imageId: objectId }),
};

export const listProductsSchema = {
  query: z
    .object({
      q: z.string().trim().max(100).optional(),
      category: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9-]+$/)
        .max(80)
        .optional(),
      minPrice: z.coerce.number().int().min(0).optional(),
      maxPrice: z.coerce.number().int().min(0).optional(),
      minRating: z.coerce.number().min(0).max(5).optional(),
      sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
      sort: z.enum(['newest', 'price_asc', 'price_desc', 'rating']).default('newest'),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .default(20)
        .transform((n) => Math.min(n, 50)),
    })
    .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
      message: 'minPrice must not be greater than maxPrice',
      path: ['minPrice'],
    }),
};
