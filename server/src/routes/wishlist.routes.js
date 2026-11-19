import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as c from '../controllers/wishlist.controller.js';
import { productIdParam } from '../validators/cart.validators.js';

const router = Router();
router.use(requireAuth, requireRole('customer'));

router.get('/', h(c.list));
router.post('/:productId', validate(productIdParam), h(c.add));
router.delete('/:productId', validate(productIdParam), h(c.remove));

export default router;
