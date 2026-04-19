/**
 * Zod schemas for AI tool form validation.
 */
import { z } from 'zod';

export const createToolSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(500),
    schema: z.record(z.string(), z.unknown()),
    kind: z.enum(['native', 'mcp', 'http']),
    mcp_server_id: z.string().optional(),
    http_endpoint: z
      .object({
        url: z.string().url(),
        method: z.enum(['GET', 'POST']),
        auth_header: z.string().optional(),
      })
      .optional(),
    dangerous: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'mcp' && !v.mcp_server_id) {
      ctx.addIssue({
        path: ['mcp_server_id'],
        code: 'custom',
        message: 'Required for MCP tools',
      });
    }
    if (v.kind === 'http' && !v.http_endpoint) {
      ctx.addIssue({
        path: ['http_endpoint'],
        code: 'custom',
        message: 'Required for HTTP tools',
      });
    }
  });

export const updateToolSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(500).optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
    kind: z.enum(['native', 'mcp', 'http']).optional(),
    mcp_server_id: z.string().optional(),
    http_endpoint: z
      .object({
        url: z.string().url(),
        method: z.enum(['GET', 'POST']),
        auth_header: z.string().optional(),
      })
      .optional(),
    dangerous: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'mcp' && v.mcp_server_id === undefined) {
      // Only enforced when kind is explicitly changed to mcp; partial updates
      // may flip kind without supplying a server — reject that shape.
      ctx.addIssue({
        path: ['mcp_server_id'],
        code: 'custom',
        message: 'Required when switching to MCP kind',
      });
    }
    if (v.kind === 'http' && v.http_endpoint === undefined) {
      ctx.addIssue({
        path: ['http_endpoint'],
        code: 'custom',
        message: 'Required when switching to HTTP kind',
      });
    }
  });

export type CreateToolFormValues = z.infer<typeof createToolSchema>;
export type UpdateToolFormValues = z.infer<typeof updateToolSchema>;
