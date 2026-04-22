/**
 * Zod schemas for the notifications (inbox) feature.
 */
import { z } from 'zod';

/** Plugin-slug regex from Plan 7 §11 — lowercase, digits, hyphens. */
export const PLUGIN_SLUG_REGEX = /^[a-z][a-z0-9-]*$/;

/** Category regex for plugin-emitted notifications. */
export const PLUGIN_CATEGORY_REGEX = /^plugin:[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

/** Built-in (non-plugin) category set. */
export const BUILT_IN_CATEGORIES = ['system', 'security', 'audit'] as const;

export const severitySchema = z.enum(['info', 'warn', 'error', 'success']);

export const actionSchema = z.object({
  label: z.string().min(1).max(40),
  href: z.string().min(1).max(1024),
});

/** Category: either a built-in bucket or `plugin:<slug>(.<slug>)*`. */
export const categorySchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (v) =>
      BUILT_IN_CATEGORIES.includes(v as (typeof BUILT_IN_CATEGORIES)[number]) ||
      PLUGIN_CATEGORY_REGEX.test(v),
    {
      message:
        'Category must be one of "system" | "security" | "audit", or match `plugin:<slug>` where <slug> is dot-separated lowercase reverse-DNS.',
    },
  );

export const inboxFilterSchema = z.object({
  categories: z.array(z.string()).default([]),
  severities: z.array(severitySchema).default([]),
  unreadOnly: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  search: z.string().max(500).default(''),
});

export type InboxFilterFormValues = z.infer<typeof inboxFilterSchema>;

export const emitNotificationInputSchema = z.object({
  tenant_id: z.string().nullable(),
  user_id: z.string().min(1),
  category: categorySchema,
  severity: severitySchema,
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  action: actionSchema.optional(),
});

export type EmitNotificationFormValues = z.infer<typeof emitNotificationInputSchema>;
