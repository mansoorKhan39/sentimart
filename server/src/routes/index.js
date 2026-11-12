import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';

const router = Router();
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
// Later modules mount here: /products, /cart, /orders, /reviews, /seller, /admin

export default router;
