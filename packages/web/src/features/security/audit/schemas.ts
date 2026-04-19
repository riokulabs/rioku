/**
 * Zod schemas for the audit feature filter form.
 */
import { z } from 'zod';

export const auditFilterSchema = z.object({
  actions: z.array(z.string()).default([]),
  outcomes: z.array(z.enum(['success', 'denied', 'error'])).default([]),
  resource_types: z.array(z.string()).default([]),
  tiers: z.array(z.enum(['read', 'read-sensitive', 'write', 'destructive'])).default([]),
  actor_id: z.string().default(''),
  resource_id: z.string().default(''),
  date_from: z.string().default(''),
  date_to: z.string().default(''),
  tenant_id: z.string().default(''),
});

export type AuditFilterSchema = z.infer<typeof auditFilterSchema>;
