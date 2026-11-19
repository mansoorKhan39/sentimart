import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as c from '../controllers/category.controller.js';
import { idParam } from '../validators/common.validators.js';
import { categoryBodySchema, categoryUpdateSchema } from '../validators/catalog.validators.js';

const router = Router();
const admin = [requireAuth, requireRole('admin')];

router.get('/', h(c.list));
router.post('/', ...admin, validate(categoryBodySchema), h(c.create));
router.patch('/:id', ...admin, validate(categoryUpdateSchema), h(c.update));
router.delete('/:id', ...admin, validate(idParam), h(c.remove));

export default router;
