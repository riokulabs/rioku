/**
 * Zod schemas for middleware form validation.
 *
 * The `middlewareConfigSchemas` map holds per-kind config shapes. The
 * top-level `createMiddlewareSchema` uses `z.unknown()` for `config`; UI
 * code calls `middlewareConfigSchemas[kind].parse(config)` for the per-kind
 * validation step.
 */
import { z } from 'zod';

export const rateLimitConfigSchema = z.object({
  requests_per_minute: z.number().int().min(1).max(100_000),
  burst: z.number().int().min(0),
  key_by: z.enum(['ip', 'user', 'api-key', 'header']),
  header_name: z.string().optional(),
});

export const authConfigSchema = z.object({
  mode: z.enum(['bearer', 'basic', 'api-key', 'mtls']),
  required_scope: z.string().optional(),
});

export const transformConfigSchema = z.object({
  request_body_template: z.string().optional(),
  response_body_template: z.string().optional(),
});

export const corsConfigSchema = z.object({
  allowed_origins: z.array(z.string()).default([]),
  allowed_methods: z
    .array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']))
    .default([]),
  allow_credentials: z.boolean().default(false),
});

export const cacheConfigSchema = z.object({
  ttl_seconds: z.number().int().min(1),
  vary_headers: z.array(z.string()).default([]),
});

export const loggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  fields: z.array(z.string()).default([]),
});

export const customConfigSchema = z.record(z.string(), z.unknown());

export const middlewareConfigSchemas = {
  'rate-limit': rateLimitConfigSchema,
  auth: authConfigSchema,
  transform: transformConfigSchema,
  cors: corsConfigSchema,
  cache: cacheConfigSchema,
  logging: loggingConfigSchema,
  custom: customConfigSchema,
} as const;

export const MIDDLEWARE_KINDS = [
  'rate-limit',
  'auth',
  'transform',
  'cors',
  'cache',
  'logging',
  'custom',
] as const;

export const createMiddlewareSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(MIDDLEWARE_KINDS),
  description: z.string().max(500).optional(),
  config: z.unknown(),
  enabled: z.boolean().default(true),
  order_hint: z.number().int().default(100),
});

export const updateMiddlewareSchema = createMiddlewareSchema.partial();

export type CreateMiddlewareFormValues = z.infer<typeof createMiddlewareSchema>;
export type UpdateMiddlewareFormValues = z.infer<typeof updateMiddlewareSchema>;
