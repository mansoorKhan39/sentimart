// Local development entry. On Vercel the app is served through api/index.js.
import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { logger } from './utils/logger.js';

await connectDB();
app.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}/api/v1`));
