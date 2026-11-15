import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireApprovedSeller, requireRole } from '../middleware/rbac.js';
import * as c from '../controllers/review.controller.js';
import { idParam } from '../validators/common.validators.js';
import { replySchema, updateReviewSchema } from '../validators/review.validators.js';

const router = Router();

router.patch('/:id', requireAuth, requireRole('customer'), validate(updateReviewSchema), h(c.update));
router.delete('/:id', requireAuth, requireRole('customer'), validate(idParam), h(c.remove));
router.post('/:id/reply', requireAuth, requireApprovedSeller, validate(replySchema), h(c.reply));

export default router;
