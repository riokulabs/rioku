/**
 * Zod schemas for dashboard-builder form validation.
 */
import { z } from 'zod';

const positionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

export const addWidgetSchema = z.object({
  kind: z.string().min(1),
  title: z.string().min(1).max(120),
  data_source: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  raw_query: z.string().default(''),
  position: positionSchema.optional(),
});

export const updateWidgetSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  kind: z.string().optional(),
  data_source: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  raw_query: z.string().optional(),
  locked_advanced: z.boolean().optional(),
});

export const layoutSchema = z.record(z.string(), positionSchema);
