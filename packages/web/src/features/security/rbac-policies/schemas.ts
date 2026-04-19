/**
 * Zod schemas for rbac-policy form validation.
 */
import { z } from 'zod';

export const rbacPolicySchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(120, 'Name must be 120 characters or fewer'),
    description: z.string().max(500, 'Description must be 500 characters or fewer'),
    policy_type: z.enum(['totp-required', 'step-up-required', 'login-window', 'custom']),
    affected_role_ids: z
      .array(z.string())
      .min(1, 'At least one role must be selected'),
    condition: z.string().optional(),
    window: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.policy_type === 'custom' && (!val.condition || val.condition.trim().length === 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'CEL condition is required for custom policy type',
        path: ['condition'],
      });
    }
    if (val.policy_type === 'login-window' && (!val.window || val.window.trim().length === 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Login window is required (e.g. "07:00–19:00 UTC")',
        path: ['window'],
      });
    }
    if (val.policy_type === 'step-up-required' && (!val.window || val.window.trim().length === 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Step-up timeout (seconds) is required',
        path: ['window'],
      });
    }
  });

export type RbacPolicyFormValues = z.infer<typeof rbacPolicySchema>;
