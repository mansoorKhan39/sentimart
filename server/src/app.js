import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/error.js';
import { ApiError } from './utils/ApiError.js';
import { asyncHandler } from './utils/asyncHandler.js';
import routes from './routes/index.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY_HOPS);
app.use(helmet());
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(generalLimiter);

// Health does not need the database, so it works even when Mongo is down.
app.get('/api/v1/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      db: mongoose.connection.readyState === 1 ? 'up' : 'down',
      time: new Date().toISOString(),
    },
  });
});

const ensureDb = asyncHandler(async (_req, _res, next) => {
  try {
    await connectDB();
  } catch {
    throw new ApiError(503, 'DB_UNAVAILABLE', 'Service temporarily unavailable');
  }
  next();
});

app.use('/api/v1', ensureDb, routes);
app.use(notFound);
app.use(errorHandler);

export default app;
