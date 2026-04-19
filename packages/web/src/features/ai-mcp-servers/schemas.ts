/**
 * Zod schemas for MCP server form validation.
 */
import { z } from 'zod';

export const createMcpServerSchema = z
  .object({
    name: z.string().min(1).max(80),
    url: z.url(),
    auth_kind: z.enum(['none', 'bearer', 'api-key']),
    description: z.string().max(500).optional(),
    auth_credential: z.string().min(1).optional(),
    authorized_agent_ids: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.auth_kind !== 'none' && !v.auth_credential) {
      ctx.addIssue({
        path: ['auth_credential'],
        code: 'custom',
        message: 'Required when auth_kind is not "none"',
      });
    }
  });

export const updateMcpServerSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    url: z.url().optional(),
    auth_kind: z.enum(['none', 'bearer', 'api-key']).optional(),
    description: z.string().max(500).optional(),
    auth_credential: z.string().min(1).optional(),
    authorized_agent_ids: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
  });

export type CreateMcpServerFormValues = z.infer<typeof createMcpServerSchema>;
export type UpdateMcpServerFormValues = z.infer<typeof updateMcpServerSchema>;
