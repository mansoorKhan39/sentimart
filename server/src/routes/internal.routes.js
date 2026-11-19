import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { requireCronSecret } from '../middleware/cron.js';
import * as c from '../controllers/review.controller.js';

const router = Router();
router.use(requireCronSecret);

// Vercel Cron calls with GET; POST is allowed for manual runs.
router.get('/retry-pending', h(c.retryPending));
router.post('/retry-pending', h(c.retryPending));

export default router;
