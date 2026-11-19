import { z } from 'zod';
import { PAYMENT_METHODS, SELLER_TRANSITIONS, SUB_ORDER_STATUSES } from '../config/constants.js';
import { idParam, objectId } from './common.validators.js';

const phone = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s]{7,20}$/, 'Invalid phone number');

export const createOrderSchema = {
  body: z
    .object({
      address: z
        .object({
          line1: z.string().trim().min(5).max(200),
          city: z.string().trim().min(2).max(80),
          phone: phone.optional(),
        })
        .strict(),
      // Strict body: a card number or any other extra field is rejected, never stored.
      paymentMethod: z.enum(PAYMENT_METHODS),
    })
    .strict(),
};

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const listQuery = { query: pageQuery };
export const orderIdParam = { params: z.object({ id: objectId }) };
export const subOrderIdParam = idParam;

export const sellerListQuery = {
  query: pageQuery.extend({ status: z.enum(SUB_ORDER_STATUSES).optional() }),
};

export const sellerStatusSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(Object.keys(SELLER_TRANSITIONS)) }).strict(),
};
