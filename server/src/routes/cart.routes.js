import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as c from '../controllers/cart.controller.js';
import { productIdParam, setQuantitySchema } from '../validators/cart.validators.js';

const router = Router();
router.use(requireAuth, requireRole('customer'));

router.get('/', h(c.get));
router.put('/items/:productId', validate(setQuantitySchema), h(c.setQuantity));
router.delete('/items/:productId', validate(productIdParam), h(c.removeItem));
router.delete('/', h(c.clear));

export default router;
