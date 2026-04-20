/**
 * Zod schemas for dashboard forms and JSON import validation.
 */
import { z } from 'zod';

export const dashboardVariableSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['text', 'enum', 'interval']),
  default: z.string(),
  options: z.array(z.string()).optional(),
});

export const createDashboardSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  mode: z.enum(['metabase', 'grafana']).default('metabase'),
  scope: z.enum(['personal', 'tenant', 'shared']).default('tenant'),
  owner_user_id: z.string().nullable().default(null),
  shared_role_ids: z.array(z.string()).default([]),
  variables: z.array(dashboardVariableSchema).default([]),
});

export const updateDashboardSchema = createDashboardSchema.partial();

const widgetShapeSchema = z.object({
  id: z.string(),
  dashboard_id: z.string(),
  kind: z.string(),
  title: z.string(),
  config: z.record(z.string(), z.unknown()),
  position: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  data_source: z.string(),
  raw_query: z.string(),
  wizard_state: z.unknown().optional(),
  locked_advanced: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const dashboardShapeSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  default: z.boolean(),
  widget_ids: z.array(z.string()),
  description: z.string().optional(),
  owner_user_id: z.string().nullable(),
  mode: z.enum(['metabase', 'grafana']),
  scope: z.enum(['personal', 'tenant', 'shared']),
  shared_role_ids: z.array(z.string()),
  layout: z.record(
    z.string(),
    z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  ),
  variables: z.array(dashboardVariableSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Schema for the JSON export payload. Used by `importDashboardJson`. */
export const dashboardExportSchema = z.object({
  version: z.literal('plan4-v1'),
  exported_at: z.string(),
  dashboard: dashboardShapeSchema,
  widgets: z.array(widgetShapeSchema),
});

export type CreateDashboardFormValues = z.infer<typeof createDashboardSchema>;
export type UpdateDashboardFormValues = z.infer<typeof updateDashboardSchema>;
