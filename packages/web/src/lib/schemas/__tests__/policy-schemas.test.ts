import { describe, it, expect } from 'vitest'
import {
  rateLimitSchema,
  corsSchema,
  policySchemaFor,
  authJwtSchema,
  authApiKeySchema,
  transformSchema,
  circuitBreakerSchema,
  cacheSchema,
  retrySchema,
} from '../policy-schemas'

describe('rateLimitSchema', () => {
  it('validates a complete config', () => {
    const result = rateLimitSchema.safeParse({
      requestsPerWindow: 100,
      windowUnit: 'minute',
      scope: 'per_ip',
      tokenAware: true,
      inputTokenLimit: 5000,
      outputTokenLimit: 10000,
      totalTokenLimit: 15000,
      costAware: true,
      dailyBudgetUsd: 50.0,
      burstAllowance: 10,
      responseWhenLimited: '429',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing requestsPerWindow', () => {
    const result = rateLimitSchema.safeParse({
      windowUnit: 'minute',
      scope: 'per_ip',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0])
      expect(fields).toContain('requestsPerWindow')
    }
  })

  it('validates token-aware fields', () => {
    const result = rateLimitSchema.safeParse({
      requestsPerWindow: 50,
      windowUnit: 'hour',
      scope: 'per_agent',
      tokenAware: true,
      inputTokenLimit: 1000,
      outputTokenLimit: 2000,
      totalTokenLimit: 3000,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tokenAware).toBe(true)
      expect(result.data.inputTokenLimit).toBe(1000)
      expect(result.data.outputTokenLimit).toBe(2000)
      expect(result.data.totalTokenLimit).toBe(3000)
    }
  })
})

describe('corsSchema', () => {
  it('validates a complete config', () => {
    const result = corsSchema.safeParse({
      allowedOrigins: ['https://example.com'],
      allowedMethods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: '3600',
      allowCredentials: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty allowedOrigins', () => {
    const result = corsSchema.safeParse({
      allowedOrigins: [],
      allowedMethods: ['GET'],
    })
    expect(result.success).toBe(false)
  })

  it('accepts wildcard origin', () => {
    const result = corsSchema.safeParse({
      allowedOrigins: ['*'],
      allowedMethods: ['GET'],
    })
    expect(result.success).toBe(true)
  })
})

describe('policySchemaFor', () => {
  it.each([
    'rate_limit',
    'auth_jwt',
    'auth_api_key',
    'cors',
    'transform',
    'circuit_breaker',
    'cache',
    'retry',
  ])('returns a schema for type "%s"', (type) => {
    const schema = policySchemaFor(type)
    expect(schema).toBeDefined()
    expect(typeof schema.safeParse).toBe('function')
  })

  it('throws for unknown policy type', () => {
    expect(() => policySchemaFor('unknown_type')).toThrow(
      'Unknown policy type: unknown_type'
    )
  })
})
