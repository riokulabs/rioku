/**
 * Zod schemas for access-policy form validation.
 */
import { z } from 'zod';

export const accessPolicySchema = z.object({
  name: z.string().min(1, 'Name is required').max(120, 'Name must be 120 characters or fewer'),
  condition: z.string().min(1, 'CEL condition is required'),
  action: z.enum(['allow', 'deny']),
  priority: z
    .number({ message: 'Priority must be a number' })
    .int('Priority must be an integer')
    .min(0, 'Priority must be ≥ 0')
    .max(9999, 'Priority must be ≤ 9999'),
  enabled: z.boolean(),
});

export type AccessPolicyFormValues = z.infer<typeof accessPolicySchema>;
