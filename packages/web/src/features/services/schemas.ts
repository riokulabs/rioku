/**
 * Zod schemas for service form validation.
 */
import { z } from 'zod';

export const createServiceSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  upstream: z.string().min(1),
  upstream_protocol: z.enum(['http', 'https', 'grpc']),
  env: z.string().min(1),
  tags: z.array(z.string()).default([]),
  health_check: z
    .object({
      path: z.string().startsWith('/'),
      interval_seconds: z.number().int().min(1).max(3600),
      timeout_seconds: z.number().int().min(1).max(60),
    })
    .optional(),
});

export const updateServiceSchema = createServiceSchema.partial();

export type CreateServiceFormValues = z.infer<typeof createServiceSchema>;
export type UpdateServiceFormValues = z.infer<typeof updateServiceSchema>;
