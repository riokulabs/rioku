/**
 * Zod schemas for sites forms (wizard + edit).
 */
import { z } from 'zod';

export const createSiteWizardSchema = z
  .object({
    name: z.string().min(1).max(64),
    domain: z
      .string()
      .regex(
        /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
        'Invalid domain',
      ),
    upstream_mode: z.enum(['existing_service', 'new_upstream']),
    upstream_service_id: z.string().optional(),
    upstream_protocol: z.enum(['http', 'https', 'grpc']).optional(),
    upstream_host: z.string().optional(),
    upstream_port: z.number().int().min(1).max(65535).optional(),
    tls_mode: z.enum(['auto', 'manual', 'off']),
    tls_manual_cert_pem: z.string().optional(),
    tls_manual_key_pem: z.string().optional(),
    basic_auth_enabled: z.boolean().default(false),
    rate_limit_preset: z
      .enum(['none', 'lenient', 'standard', 'strict'])
      .default('none'),
    redirect_rules: z
      .array(
        z.object({
          from: z.string().startsWith('/'),
          to: z.string().startsWith('/'),
          status: z.union([
            z.literal(301),
            z.literal(302),
            z.literal(307),
            z.literal(308),
          ]),
        }),
      )
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (v.upstream_mode === 'existing_service' && !v.upstream_service_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['upstream_service_id'],
        message: 'Required',
      });
    }
    if (
      v.upstream_mode === 'new_upstream' &&
      (!v.upstream_host || !v.upstream_protocol)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['upstream_host'],
        message: 'Required',
      });
    }
    if (
      v.tls_mode === 'manual' &&
      (!v.tls_manual_cert_pem || !v.tls_manual_key_pem)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['tls_manual_cert_pem'],
        message: 'PEM required for manual TLS',
      });
    }
  });

export const updateSiteSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  domain: z
    .string()
    .regex(
      /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      'Invalid domain',
    )
    .optional(),
  tls_mode: z.enum(['auto', 'manual', 'off']).optional(),
  upstream_service_id: z.string().optional(),
  basic_auth_enabled: z.boolean().optional(),
  rate_limit_preset: z.enum(['none', 'lenient', 'standard', 'strict']).optional(),
  redirect_rules: z
    .array(
      z.object({
        from: z.string().startsWith('/'),
        to: z.string().startsWith('/'),
        status: z.union([
          z.literal(301),
          z.literal(302),
          z.literal(307),
          z.literal(308),
        ]),
      }),
    )
    .optional(),
});

export type CreateSiteWizardFormValues = z.infer<typeof createSiteWizardSchema>;
export type UpdateSiteFormValues = z.infer<typeof updateSiteSchema>;
