/**
 * Zod schemas for AI trace filter validation.
 *
 * Traces are read-only; the only forms on this feature are filter widgets.
 */
import { z } from 'zod';

export const traceFilterSchema = z.object({
  search: z.string().max(500).default(''),
  agent_ids: z.array(z.string()).default([]),
  statuses: z
    .array(z.enum(['success', 'error', 'timeout']))
    .default([]),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});

export type TraceFilterFormValues = z.infer<typeof traceFilterSchema>;
