/**
 * Zod schemas for AI tool-binding form validation.
 */
import { z } from 'zod';

export const createBindingSchema = z.object({
  agent_id: z.string().min(1),
  tool_id: z.string().min(1),
  condition: z.string().max(2000),
  enabled: z.boolean().default(true),
});

export const updateBindingSchema = z.object({
  agent_id: z.string().min(1).optional(),
  tool_id: z.string().min(1).optional(),
  condition: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
});

export type CreateBindingFormValues = z.infer<typeof createBindingSchema>;
export type UpdateBindingFormValues = z.infer<typeof updateBindingSchema>;
