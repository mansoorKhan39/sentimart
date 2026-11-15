import { z } from 'zod';
import { APPROVAL_STATUSES } from '../config/constants.js';
import { idParam, objectId, pageShape } from './common.validators.js';

const q = z.string().trim().max(100).optional();

export const adminUsersQuery = {
  query: z.object({
    q,
    role: z.enum(['customer', 'seller', 'admin']).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    ...pageShape(20),
  }),
};
export const userStatusSchema = {
  ...idParam,
  body: z.object({ status: z.enum(['active', 'suspended']) }).strict(),
};

export const adminSellersQuery = {
  query: z.object({ q, status: z.enum(APPROVAL_STATUSES).optional(), ...pageShape(20) }),
};
export const sellerApprovalSchema = {
  ...idParam,
  body: z
    .object({
      approvalStatus: z.enum(['approved', 'rejected']),
      reason: z.string().trim().min(3).max(500).optional(),
    })
    .strict(),
};

export const adminProductsQuery = {
  query: z.object({
    q,
    status: z.enum(['active', 'hidden']).optional(),
    sellerId: objectId.optional(),
    ...pageShape(20),
  }),
};
export const productStatusSchema = {
  ...idParam,
  body: z.object({ status: z.enum(['active', 'hidden']) }).strict(),
};

export const flaggedQuery = { query: z.object({ ...pageShape(20) }) };
export const moderateSchema = {
  ...idParam,
  body: z.object({ action: z.enum(['approve', 'remove']) }).strict(),
};

export const auditQuery = {
  query: z.object({ action: z.string().trim().max(60).optional(), ...pageShape(20) }),
};
