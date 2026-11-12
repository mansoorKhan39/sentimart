import { z } from 'zod';

const address = z
  .object({
    label: z.string().trim().max(30).optional(),
    line1: z.string().trim().min(3).max(200),
    city: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(20).optional(),
  })
  .strict();

export const updateMeSchema = {
  body: z
    .object({
      name: z.string().trim().min(2).max(80).optional(),
      addresses: z.array(address).max(5).optional(),
    })
    .strict(),
};
