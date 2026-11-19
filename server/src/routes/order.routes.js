import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as c from '../controllers/order.controller.js';
import { createOrderSchema, listQuery, orderIdParam } from '../validators/order.validators.js';

const router = Router();
router.use(requireAuth, requireRole('customer'));

router.post('/', validate(createOrderSchema), h(c.create));
router.get('/', validate(listQuery), h(c.list));
router.get('/:id', validate(orderIdParam), h(c.getOne));

export default router;
