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

// ─── Tenant ───────────────────────────────────────────────────────────────────

export const tenantNameSchema = z.object({
  name: z.string().min(1, 'Tenant name is required').max(100, 'Tenant name too long'),
});

export type TenantNameValues = z.infer<typeof tenantNameSchema>;

// ─── Preferences ──────────────────────────────────────────────────────────────

export const preferencesSchema = z.object({
  theme: z.string().min(1),
  locale: z.enum(['en', 'ar']),
  timezone: z.string().min(1, 'Timezone is required'),
  reduced_motion: z.boolean(),
  notification_email: z.boolean(),
  notification_in_app: z.boolean(),
  categories_muted: z.array(z.string()),
});

export type PreferencesValues = z.infer<typeof preferencesSchema>;

// ─── Tenant auth policy ───────────────────────────────────────────────────────

export const tenantAuthPolicySchema = z.object({
  totp_policy: z.enum(['all', 'admins', 'optional']),
  password_policy: z.object({
    min_length: z.number().int().min(6).max(128),
    require_uppercase: z.boolean(),
    require_digit: z.boolean(),
    require_symbol: z.boolean(),
    max_age_days: z.number().int().min(0).max(3650),
    history_depth: z.number().int().min(0).max(24),
  }),
  session_timeouts: z.object({
    idle_hours: z.number().int().min(0).max(168),
    absolute_hours: z.number().int().min(1).max(720),
  }),
});

export type TenantAuthPolicyValues = z.infer<typeof tenantAuthPolicySchema>;

// ─── Network config ───────────────────────────────────────────────────────────

export const networkConfigSchema = z.object({
  caddy_config_overrides: z.string(),   // JSON string; validated at blur in component
  http3_enabled: z.boolean(),
  upstream_timeouts: z.object({
    connect: z.number().int().min(1).max(300),
    read: z.number().int().min(1).max(3600),
    write: z.number().int().min(1).max(3600),
    idle: z.number().int().min(1).max(3600),
  }),
});

export type NetworkConfigValues = z.infer<typeof networkConfigSchema>;

// ─── PKI — Create CA ─────────────────────────────────────────────────────────

export const createCaSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(['internal', 'external']),
  subject: z.string().min(1).max(200),
  certificate_pem: z.string(),
}).refine((v) => v.kind === 'internal' || v.certificate_pem.length > 0, {
  message: 'PEM required for external CAs',
  path: ['certificate_pem'],
});

export type CreateCaValues = z.infer<typeof createCaSchema>;

// ─── PKI — Create Enrollment ──────────────────────────────────────────────────

export const createEnrollmentSchema = z.object({
  ca_id: z.string().min(1),
  subject: z.string().min(1).max(200),
  dns_sans: z.array(z.string().min(1)).default([]),
  validity_days: z.number().int().min(1).max(3650),
});

export type CreateEnrollmentValues = z.infer<typeof createEnrollmentSchema>;
