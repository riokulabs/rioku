/**
 * Zod schemas for route form validation.
 */
import { z } from 'zod';

/** Returns true when `pattern` compiles as a JS RegExp. */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export const createRouteSchema = z
  .object({
    service_id: z.string().min(1),
    name: z.string().min(1).max(80),
    path: z.string().startsWith('/'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY']),
    match_kind: z.enum(['prefix', 'exact', 'regex']),
    strip_prefix: z.boolean().default(false),
    rewrite_path: z.string().optional(),
    headers_add: z.record(z.string(), z.string()).default({}),
    headers_remove: z.array(z.string()).default([]),
    policies: z.array(z.string()).default([]),
    middleware_ids: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
  })
  .refine((v) => v.match_kind !== 'regex' || isValidRegex(v.path), {
    path: ['path'],
    message: 'Invalid regex pattern',
  });

export const updateRouteSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    path: z.string().startsWith('/').optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY']).optional(),
    match_kind: z.enum(['prefix', 'exact', 'regex']).optional(),
    strip_prefix: z.boolean().optional(),
    rewrite_path: z.string().optional(),
    headers_add: z.record(z.string(), z.string()).optional(),
    headers_remove: z.array(z.string()).optional(),
    policies: z.array(z.string()).optional(),
    middleware_ids: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.match_kind === undefined ||
      v.match_kind !== 'regex' ||
      v.path === undefined ||
      isValidRegex(v.path),
    { path: ['path'], message: 'Invalid regex pattern' },
  );

export type CreateRouteFormValues = z.infer<typeof createRouteSchema>;
export type UpdateRouteFormValues = z.infer<typeof updateRouteSchema>;
