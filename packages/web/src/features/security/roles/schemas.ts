/**
 * Zod schemas for role form validation.
 */
import { z } from 'zod';

export const roleCreateSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(120, 'Name must be 120 characters or fewer')
    .regex(
      /^[a-z0-9][a-z0-9\-.:]*$/,
      'Name must be lowercase alphanumeric with hyphens, dots, or colons',
    ),
  description: z.string().max(500).optional(),
  parent_id: z.string().optional(),
});

export type RoleCreateFormValues = z.infer<typeof roleCreateSchema>;
