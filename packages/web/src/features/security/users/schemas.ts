/**
 * Zod schemas for user form validation.
 */
import { z } from 'zod';

export const inviteUserSchema = z.object({
  email: z.email('Must be a valid email address'),
  name: z.string().max(120).optional(),
  tenant_id: z.string().min(1, 'Tenant is required'),
  role_ids: z.array(z.string()).min(1, 'At least one role is required'),
  force_totp_on_first_login: z.boolean(),
});

export const editUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  // email is read-only after creation — not in the edit schema
  disabled: z.boolean(),
  role_ids: z.array(z.string()),
});

export type InviteUserFormValues = z.infer<typeof inviteUserSchema>;
export type EditUserFormValues = z.infer<typeof editUserSchema>;
