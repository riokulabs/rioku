/**
 * Zod schemas for the audit feature.
 *
 * - `auditFilterSchema` — validates the combined filter URL/state shape.
 * - `retentionConfigSchema` — validates the retention-config form input.
 */
import { z } from 'zod';

export const auditFilterSchema = z.object({
  actions: z.array(z.string()).default([]),
  outcomes: z.array(z.enum(['success', 'denied', 'error'])).default([]),
  resource_types: z.array(z.string()).default([]),
  tiers: z
    .array(z.enum(['read', 'read-sensitive', 'write', 'destructive']))
    .default([]),
  date_from: z.string().nullable().default(null),
  date_to: z.string().nullable().default(null),
  actor_handles: z.array(z.string()).default([]),
  resource_id_handles: z.array(z.string()).default([]),
  search: z.string().max(500).default(''),
});

export type AuditFilterFormValues = z.infer<typeof auditFilterSchema>;

/** Per-tier retention bounds — 0 means "delete immediately"; cap at 10 years. */
const retentionDayField = z.number().int().min(0).max(3650);

export const retentionConfigSchema = z.object({
  retention_days: z.object({
    read: retentionDayField,
    'read-sensitive': retentionDayField,
    write: retentionDayField,
    destructive: retentionDayField,
  }),
  auto_export: z.enum(['daily', 'weekly', 'monthly', 'never']),
  auto_export_format: z.enum(['csv', 'jsonl']),
});

export type RetentionConfigFormValues = z.infer<typeof retentionConfigSchema>;
