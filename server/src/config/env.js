import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(1),
  MONGODB_MAX_POOL: z.coerce.number().int().min(1).max(20).default(5),
  CLIENT_ORIGIN: z.string().url(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  RESET_TOKEN_TTL_MIN: z.coerce.number().int().min(5).default(15),
  BCRYPT_COST: z.coerce.number().int().min(10).max(14).default(12),
  RATE_LIMIT_GENERAL_PER_MIN: z.coerce.number().int().min(1).default(100),
  LOGIN_MAX_FAILS: z.coerce.number().int().min(3).default(5),
  LOGIN_WINDOW_MIN: z.coerce.number().int().min(1).default(15),
  SENDGRID_API_KEY: z.string().optional().default(''),
  MAIL_FROM: z.string().default('SentiMart <no-reply@example.com>'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  // Fail fast: a misconfigured server must not start.
  throw new Error(`Invalid environment variables:\n${problems}`);
}

export const env = Object.freeze(parsed.data);
export const isProd = env.NODE_ENV === 'production';
