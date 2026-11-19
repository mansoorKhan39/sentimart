import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as c from '../controllers/order.controller.js';
import { subOrderIdParam } from '../validators/order.validators.js';

const router = Router();
router.use(requireAuth, requireRole('customer'));

router.patch('/:id/cancel', validate(subOrderIdParam), h(c.cancel));

export default router;
