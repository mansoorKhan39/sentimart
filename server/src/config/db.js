import mongoose from 'mongoose';
import { env } from './env.js';

// Serverless: reuse one connection across warm invocations of the same instance.
const cache = globalThis.__sentimartMongo || (globalThis.__sentimartMongo = { promise: null });

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!cache.promise) {
    mongoose.set('strictQuery', true);
    cache.promise = mongoose
      .connect(env.MONGODB_URI, {
        maxPoolSize: env.MONGODB_MAX_POOL,
        serverSelectionTimeoutMS: 5000,
      })
      .catch((err) => {
        cache.promise = null; // allow retry on the next request
        throw err;
      });
  }
  await cache.promise;
  return mongoose.connection;
}
