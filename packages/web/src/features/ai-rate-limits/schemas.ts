/**
 * Zod schemas for AI semantic rate-limit form validation.
 */
import { z } from 'zod';

export const createRateLimitSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    scope: z.enum(['tenant', 'agent', 'tool']),
    agent_id: z.string().optional(),
    tool_id: z.string().optional(),
    exemplars: z.array(z.string().min(1)).min(1).max(50),
    similarity_threshold: z.number().min(0).max(1),
    window_seconds: z.number().int().min(1).max(86_400),
    max_matches: z.number().int().min(1),
    action: z.enum(['block', 'degrade', 'log']),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'agent' && !v.agent_id) {
      ctx.addIssue({
        path: ['agent_id'],
        code: 'custom',
        message: 'Required for agent scope',
      });
    }
    if (v.scope === 'tool' && !v.tool_id) {
      ctx.addIssue({
        path: ['tool_id'],
        code: 'custom',
        message: 'Required for tool scope',
      });
    }
  });

export const updateRateLimitSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
    scope: z.enum(['tenant', 'agent', 'tool']).optional(),
    agent_id: z.string().optional(),
    tool_id: z.string().optional(),
    exemplars: z.array(z.string().min(1)).min(1).max(50).optional(),
    similarity_threshold: z.number().min(0).max(1).optional(),
    window_seconds: z.number().int().min(1).max(86_400).optional(),
    max_matches: z.number().int().min(1).optional(),
    action: z.enum(['block', 'degrade', 'log']).optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'agent' && v.agent_id === undefined) {
      ctx.addIssue({
        path: ['agent_id'],
        code: 'custom',
        message: 'Required when switching to agent scope',
      });
    }
    if (v.scope === 'tool' && v.tool_id === undefined) {
      ctx.addIssue({
        path: ['tool_id'],
        code: 'custom',
        message: 'Required when switching to tool scope',
      });
    }
  });

export type CreateRateLimitFormValues = z.infer<typeof createRateLimitSchema>;
export type UpdateRateLimitFormValues = z.infer<typeof updateRateLimitSchema>;
