import { describe, it, expect, vi } from 'vitest'

// Mock all form component dependencies to avoid deep import resolution
vi.mock('@/components/ui/input', () => ({ Input: () => null }))
vi.mock('@/components/ui/label', () => ({ Label: () => null }))
vi.mock('@/components/ui/switch', () => ({ Switch: () => null }))
vi.mock('@/components/ui/button', () => ({ Button: () => null }))
vi.mock('@/components/ui/select', () => ({
  Select: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}))
vi.mock('@rioku/ui', () => ({ Checkbox: () => null }))
vi.mock('@/components/rioku/tag-input', () => ({ TagInput: () => null }))
vi.mock('@/components/rioku/duration-input', () => ({ DurationInput: () => null }))
vi.mock('@/components/rioku/kv-editor', () => ({ KvEditor: () => null }))
vi.mock('lucide-react', () => ({
  PlusIcon: () => null,
  TrashIcon: () => null,
}))

import { FORM_MAP } from '../index'

describe('PolicyFormForType registry', () => {
  it('maps POLICY_TYPE_RATE_LIMIT to RateLimitForm', () => {
    expect(FORM_MAP.POLICY_TYPE_RATE_LIMIT).toBeDefined()
    expect(FORM_MAP.POLICY_TYPE_RATE_LIMIT.name).toBe('RateLimitForm')
  })

  it('maps POLICY_TYPE_AUTHENTICATION to AuthJwtForm', () => {
    expect(FORM_MAP.POLICY_TYPE_AUTHENTICATION).toBeDefined()
    expect(FORM_MAP.POLICY_TYPE_AUTHENTICATION.name).toBe('AuthJwtForm')
  })

  it('maps POLICY_TYPE_AUTH_API_KEY to AuthApiKeyForm', () => {
    expect(FORM_MAP.POLICY_TYPE_AUTH_API_KEY).toBeDefined()
    expect(FORM_MAP.POLICY_TYPE_AUTH_API_KEY.name).toBe('AuthApiKeyForm')
  })

  it('maps POLICY_TYPE_CORS to CorsForm', () => {
    expect(FORM_MAP.POLICY_TYPE_CORS).toBeDefined()
    expect(FORM_MAP.POLICY_TYPE_CORS.name).toBe('CorsForm')
  })

  it('maps POLICY_TYPE_TRANSFORM to TransformForm', () => {
    expect(FORM_MAP.POLICY_TYPE_TRANSFORM).toBeDefined()
    expect(FORM_MAP.POLICY_TYPE_TRANSFORM.name).toBe('TransformForm')
  })

  it('maps POLICY_TYPE_CIRCUIT_BREAKER to CircuitBreakerForm', () => {
    expect(FORM_MAP.POLICY_TYPE_CIRCUIT_BREAKER).toBeDefined()
    expect(FORM_MAP.POLICY_TYPE_CIRCUIT_BREAKER.name).toBe('CircuitBreakerForm')
  })

  it('maps POLICY_TYPE_CACHE to CacheForm', () => {
    expect(FORM_MAP.POLICY_TYPE_CACHE).toBeDefined()
    expect(FORM_MAP.POLICY_TYPE_CACHE.name).toBe('CacheForm')
  })

  it('maps POLICY_TYPE_RETRY to RetryForm', () => {
    expect(FORM_MAP.POLICY_TYPE_RETRY).toBeDefined()
    expect(FORM_MAP.POLICY_TYPE_RETRY.name).toBe('RetryForm')
  })

  it('returns undefined for unknown type', () => {
    expect(FORM_MAP['POLICY_TYPE_UNKNOWN']).toBeUndefined()
  })

  it('has exactly 8 registered form types', () => {
    expect(Object.keys(FORM_MAP)).toHaveLength(8)
  })
})
