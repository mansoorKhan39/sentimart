import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import * as c from '../controllers/auth.controller.js';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '../validators/auth.validators.js';

const router = Router();
router.use(authLimiter);

router.post('/register', validate(registerSchema), h(c.register));
router.post('/login', validate(loginSchema), h(c.login));
router.post('/refresh', h(c.refresh));
router.post('/logout', h(c.logout));
router.post('/forgot-password', validate(forgotPasswordSchema), h(c.forgotPassword));
router.post('/reset-password/:token', validate(resetPasswordSchema), h(c.resetPassword));

export default router;
