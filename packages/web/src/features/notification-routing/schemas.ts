/**
 * Zod schemas for notification-routing feature.
 */
import { z } from 'zod';

/**
 * event_filter syntax (Plan 7 §11): `<category-pattern>.<subtype-pattern>`
 * where each side is a slug, a reserved keyword, or `*`. Examples:
 *
 *   audit.*             -> all audit events
 *   security.error      -> only security+error-severity events
 *   *.error             -> all error-severity events
 *   plugin:acme.*       -> all subtypes of plugin:acme categories
 *   audit.destructive   -> audit events with tier=destructive
 *
 * The category side accepts lowercase, digits, hyphens, dots, and colons.
 * The subtype side accepts the same character set OR `*`, so callers can
 * express severity-based filters (info/warn/error/success) or audit-tier
 * filters (destructive/write/read-sensitive) using the same grammar.
 */
export const EVENT_FILTER_REGEX = /^(\*|[a-z][a-z0-9:.-]*)\.(\*|[a-z][a-z0-9-]*)$/;

export const eventFilterSchema = z.string().min(1).max(256).regex(EVENT_FILTER_REGEX, {
  message:
    'event_filter must be `<category>.<subtype>` where each side is a lowercase slug (digits/hyphens/dots/colons for category) or `*`.',
});

export const createRoutingRuleSchema = z.object({
  tenant_id: z.string().min(1),
  name: z.string().min(1).max(80),
  event_filter: eventFilterSchema,
  channel_ids: z.array(z.string().min(1)).min(1),
  enabled: z.boolean().default(true),
  order_hint: z.number().int().min(0).max(1_000_000).optional(),
});

export const updateRoutingRuleSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  event_filter: eventFilterSchema.optional(),
  channel_ids: z.array(z.string().min(1)).min(1).optional(),
  enabled: z.boolean().optional(),
  order_hint: z.number().int().min(0).max(1_000_000).optional(),
});

export type CreateRoutingRuleFormValues = z.infer<typeof createRoutingRuleSchema>;
export type UpdateRoutingRuleFormValues = z.infer<typeof updateRoutingRuleSchema>;
