import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import * as c from '../controllers/user.controller.js';
import { updateMeSchema } from '../validators/user.validators.js';

const router = Router();
router.use(requireAuth);

router.get('/me', h(c.getMe));
router.patch('/me', validate(updateMeSchema), h(c.updateMe));

export default router;
