import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(72, 'At most 72 characters')
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/\d/, 'Needs a digit');

export const registerSchema = {
  body: z
    .object({
      name: z.string().trim().min(2).max(80),
      email,
      password,
      role: z.enum(['customer', 'seller']).default('customer'),
      businessName: z.string().trim().min(2).max(120).optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (v.role === 'seller' && !v.businessName) {
        ctx.addIssue({ code: 'custom', path: ['businessName'], message: 'Required for sellers' });
      }
    }),
};

export const loginSchema = {
  body: z.object({ email, password: z.string().min(1).max(72) }).strict(),
};

export const forgotPasswordSchema = { body: z.object({ email }).strict() };

export const resetPasswordSchema = {
  params: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid token') }),
  body: z.object({ password }).strict(),
};
