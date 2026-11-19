import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as c from '../controllers/order.controller.js';
import * as sc from '../controllers/seller.controller.js';
import {
  complaintsQuery,
  exportQuery,
  salesQuery,
  sentimentQuery,
} from '../validators/analytics.validators.js';
import { inventoryQuery, sellerReviewsQuery } from '../validators/seller.validators.js';
import { sellerListQuery, sellerStatusSchema } from '../validators/order.validators.js';

const router = Router();
router.use(requireAuth, requireRole('seller'));

router.get('/sub-orders', validate(sellerListQuery), h(c.sellerList));
router.patch('/sub-orders/:id/status', validate(sellerStatusSchema), h(c.sellerStatus));

router.get('/inventory', validate(inventoryQuery), h(sc.inventory));
router.get('/reviews', validate(sellerReviewsQuery), h(sc.reviews));
router.get('/analytics/overview', h(sc.overview));
router.get('/analytics/sales', validate(salesQuery), h(sc.sales));
router.get('/analytics/sentiment', validate(sentimentQuery), h(sc.sentiment));
router.get('/analytics/complaints', validate(complaintsQuery), h(sc.complaints));
router.get('/analytics/export', validate(exportQuery), h(sc.exportCsv));

export default router;
