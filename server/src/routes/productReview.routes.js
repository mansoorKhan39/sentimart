import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as c from '../controllers/review.controller.js';
import { idParam } from '../validators/common.validators.js';
import { createReviewSchema, listReviewsSchema } from '../validators/review.validators.js';

// Mounted at /products/:id/reviews
const router = Router({ mergeParams: true });
const customer = [requireAuth, requireRole('customer')];

router.get('/', validate(listReviewsSchema), h(c.list));
router.get('/eligibility', ...customer, validate(idParam), h(c.eligibility));
router.post('/', ...customer, validate(createReviewSchema), h(c.create));

export default router;
