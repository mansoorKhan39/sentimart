import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as c from '../controllers/admin.controller.js';
import { idParam } from '../validators/common.validators.js';
import { reportQuery } from '../validators/analytics.validators.js';
import {
  adminProductsQuery,
  adminSellersQuery,
  adminUsersQuery,
  auditQuery,
  flaggedQuery,
  moderateSchema,
  productStatusSchema,
  sellerApprovalSchema,
  userStatusSchema,
} from '../validators/admin.validators.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/users', validate(adminUsersQuery), h(c.listUsers));
router.patch('/users/:id/status', validate(userStatusSchema), h(c.setUserStatus));

router.get('/sellers', validate(adminSellersQuery), h(c.listSellers));
router.patch('/sellers/:id/approval', validate(sellerApprovalSchema), h(c.setSellerApproval));

router.get('/products', validate(adminProductsQuery), h(c.listProducts));
router.patch('/products/:id/status', validate(productStatusSchema), h(c.setProductStatus));
router.delete('/products/:id', validate(idParam), h(c.deleteProduct));

router.get('/reviews/flagged', validate(flaggedQuery), h(c.flagged));
router.patch('/reviews/:id/moderate', validate(moderateSchema), h(c.moderate));

router.get('/reports', validate(reportQuery), h(c.report));
router.get('/audit-log', validate(auditQuery), h(c.auditLog));

export default router;
