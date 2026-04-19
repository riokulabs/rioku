/**
 * Auth feature — Zod schemas for all auth forms.
 * spec §6 / Task 1e.83
 */
import { z } from 'zod';

// ─── Login ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z
    .email('Enter a valid email address')
    .min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

// ─── TOTP challenge ───────────────────────────────────────────────────────────

export const totpChallengeSchema = z.object({
  code: z
    .string()
    .length(6, 'Code must be exactly 6 digits')
    .regex(/^\d{6}$/, 'Code must be numeric'),
});

export type TotpChallengeFormValues = z.infer<typeof totpChallengeSchema>;

// ─── TOTP enrollment confirmation ─────────────────────────────────────────────

export const totpConfirmSchema = z.object({
  code: z
    .string()
    .length(6, 'Code must be exactly 6 digits')
    .regex(/^\d{6}$/, 'Code must be numeric'),
});

export type TotpConfirmFormValues = z.infer<typeof totpConfirmSchema>;

// ─── TOTP recovery (backup code) ─────────────────────────────────────────────

export const backupCodeSchema = z.object({
  code: z.string().min(8, 'Backup code is too short').max(32, 'Backup code is too long'),
});

export type BackupCodeFormValues = z.infer<typeof backupCodeSchema>;

// ─── Forgot password ─────────────────────────────────────────────────────────

export const forgotPasswordSchema = z.object({
  email: z
    .email('Enter a valid email address')
    .min(1, 'Email is required'),
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

// ─── Reset password ───────────────────────────────────────────────────────────

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

// ─── Accept invite ────────────────────────────────────────────────────────────

export const acceptInviteSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export type AcceptInviteFormValues = z.infer<typeof acceptInviteSchema>;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

export const bootstrapSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z
      .email('Enter a valid email address')
      .min(1, 'Email is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm: z.string().min(1, 'Please confirm your password'),
    tenant_name: z.string().min(1, 'Organization name is required'),
    tenant_slug: z
      .string()
      .min(1, 'Slug is required')
      .max(63)
      .regex(
        /^[a-z0-9][a-z0-9-]*$/,
        'Slug must be lowercase alphanumeric with hyphens',
      ),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export type BootstrapFormValues = z.infer<typeof bootstrapSchema>;
