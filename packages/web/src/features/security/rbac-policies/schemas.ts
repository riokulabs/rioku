/**
 * Zod schemas for rbac-policy form validation.
 */
import { z } from 'zod';

export const rbacPolicySchema = z.object({
  name: z.string().min(1, 'Name is required').max(120, 'Name must be 120 characters or fewer'),
  description: z.string().max(500, 'Description must be 500 characters or fewer'),
  enabled: z.boolean(),
  subject_type: z.enum(['user', 'group', 'service-account']),
  subject_id: z.string().min(1, 'Subject is required'),
  role_id: z.string().min(1, 'Role is required'),
});

export type RbacPolicyFormValues = z.infer<typeof rbacPolicySchema>;
