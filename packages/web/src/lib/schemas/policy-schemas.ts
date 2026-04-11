import { z } from 'zod'

// ---------- Rate Limit ----------
export const rateLimitSchema = z.object({
  requestsPerWindow: z.number().int().positive(),
  windowUnit: z.enum(['second', 'minute', 'hour', 'day']),
  scope: z.enum(['per_ip', 'per_api_key', 'per_agent', 'per_route', 'global']),
  tokenAware: z.boolean().optional().default(false),
  inputTokenLimit: z.number().int().positive().optional(),
  outputTokenLimit: z.number().int().positive().optional(),
  totalTokenLimit: z.number().int().positive().optional(),
  costAware: z.boolean().optional().default(false),
  dailyBudgetUsd: z.number().positive().optional(),
  burstAllowance: z.number().int().nonnegative().optional(),
  responseWhenLimited: z.enum(['429', '503', 'drop']).default('429'),
})

// ---------- Auth: JWT ----------
export const authJwtSchema = z.object({
  issuerUrl: z.string().url(),
  jwksEndpoint: z.string().url().optional(),
  audience: z.string().min(1),
  requiredClaims: z.record(z.string()).optional(),
  tokenLocation: z.enum(['header', 'cookie', 'query']).default('header'),
  clockSkewTolerance: z.string().optional(),
})

// ---------- Auth: API Key ----------
export const authApiKeySchema = z.object({
  headerName: z.string().default('X-API-Key'),
  queryParamName: z.string().optional(),
  prefix: z.string().optional(),
})

// ---------- CORS ----------
export const corsSchema = z.object({
  allowedOrigins: z.array(z.string()).min(1),
  allowedMethods: z.array(z.string()).min(1),
  allowedHeaders: z.array(z.string()).optional(),
  exposedHeaders: z.array(z.string()).optional(),
  maxAge: z.string().optional(),
  allowCredentials: z.boolean().default(false),
})

// ---------- Transform ----------
const headerOperationSchema = z.object({
  action: z.enum(['set', 'add', 'delete', 'replace']),
  name: z.string().min(1),
  value: z.string().optional(),
})

const queryOperationSchema = z.object({
  action: z.enum(['add', 'remove', 'set']),
  key: z.string().min(1),
  value: z.string().optional(),
})

export const transformSchema = z.object({
  requestHeaders: z.array(headerOperationSchema).optional(),
  responseHeaders: z.array(headerOperationSchema).optional(),
  pathRewrite: z
    .object({
      stripPrefix: z.string().optional(),
      addPrefix: z.string().optional(),
    })
    .optional(),
  queryOperations: z.array(queryOperationSchema).optional(),
})

// ---------- Circuit Breaker ----------
export const circuitBreakerSchema = z.object({
  failureThreshold: z.number().int().positive(),
  successThreshold: z.number().int().positive(),
  timeout: z.string().min(1),
  maxRequestsHalfOpen: z.number().int().positive().optional(),
  monitoredStatusCodes: z.array(z.number().int()).optional(),
})

// ---------- Cache ----------
export const cacheSchema = z.object({
  defaultMaxAge: z.string().min(1),
  cacheableStatusCodes: z.array(z.number().int()).default([200, 301, 302]),
  cacheableMethods: z.array(z.string()).default(['GET', 'HEAD']),
  maxBodySize: z.number().int().positive().optional(),
  maxBodySizeUnit: z.enum(['KB', 'MB']).optional(),
  varyHeaders: z.array(z.string()).optional(),
  staleWhileRevalidate: z.string().optional(),
})

// ---------- Retry ----------
export const retrySchema = z.object({
  maxAttempts: z.number().int().positive(),
  retryOnStatusCodes: z.array(z.number().int()).default([502, 503, 504]),
  backoffStrategy: z.enum(['none', 'constant', 'exponential']).default('none'),
  initialBackoff: z.string().optional(),
  maxBackoff: z.string().optional(),
})

// ---------- Schema Map ----------
const SCHEMA_MAP: Record<string, z.ZodTypeAny> = {
  rate_limit: rateLimitSchema,
  auth_jwt: authJwtSchema,
  auth_api_key: authApiKeySchema,
  cors: corsSchema,
  transform: transformSchema,
  circuit_breaker: circuitBreakerSchema,
  cache: cacheSchema,
  retry: retrySchema,
}

export function policySchemaFor(type: string): z.ZodTypeAny {
  const schema = SCHEMA_MAP[type]
  if (!schema) {
    throw new Error(`Unknown policy type: ${type}`)
  }
  return schema
}
