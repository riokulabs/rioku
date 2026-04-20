/**
 * Settings feature — Zod schemas.
 *
 * Used with `schemaResolver(schema, { sync: true })` in Mantine forms.
 * Task 8a.2 — Profile section.
 */
import { z } from 'zod';

// ─── Personal info ────────────────────────────────────────────────────────────

export const profileNameSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120, 'Name too long'),
});

export type ProfileNameValues = z.infer<typeof profileNameSchema>;

// ─── Password change ──────────────────────────────────────────────────────────

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z
      .string()
      .min(8, 'New password must be at least 8 characters'),
    confirm_password: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

// ─── Preferences ──────────────────────────────────────────────────────────────

export const preferencesSchema = z.object({
  theme: z.string().min(1),
  locale: z.enum(['en', 'ar']),
  timezone: z.string().min(1, 'Timezone is required'),
  reduced_motion: z.boolean(),
  notification_email: z.boolean(),
  notification_in_app: z.boolean(),
});

export type PreferencesValues = z.infer<typeof preferencesSchema>;
