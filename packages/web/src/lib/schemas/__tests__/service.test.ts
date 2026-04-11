import { describe, it, expect } from 'vitest'
import {
  serviceFormSchema,
  type ServiceFormValues,
  upstreamSchema,
  activeHealthCheckSchema,
} from '../service'

describe('serviceFormSchema', () => {
  it('accepts a valid minimal service', () => {
    const input: ServiceFormValues = {
      name: 'backend-api',
      lbPolicy: 'LB_POLICY_ROUND_ROBIN',
      upstreams: [{ address: '10.0.1.10:8080', weight: 1, tls: 'TLS_MODE_OFF' }],
      activeHealthCheck: {
        enabled: false,
        path: '/health',
        intervalSeconds: 10,
        timeoutSeconds: 5,
        healthyThreshold: 2,
        unhealthyThreshold: 3,
        expectedStatuses: [200],
      },
      passiveHealthCheck: {
        enabled: false,
        failureWindow: '',
        maxFailures: 5,
        latencyThreshold: '',
        unhealthyStatuses: [],
      },
      timeouts: { dial: '', responseHeader: '', idle: '' },
      retries: { maxAttempts: 0, retryStatuses: [] },
      connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
      labels: {},
    }
    const result = serviceFormSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const input = {
      name: '',
      lbPolicy: 'LB_POLICY_ROUND_ROBIN',
      upstreams: [{ address: '10.0.1.10:8080', weight: 1, tls: 'TLS_MODE_OFF' }],
      activeHealthCheck: { enabled: false, path: '', intervalSeconds: 0, timeoutSeconds: 0, healthyThreshold: 0, unhealthyThreshold: 0, expectedStatuses: [] },
      passiveHealthCheck: { enabled: false, failureWindow: '', maxFailures: 0, latencyThreshold: '', unhealthyStatuses: [] },
      timeouts: { dial: '', responseHeader: '', idle: '' },
      retries: { maxAttempts: 0, retryStatuses: [] },
      connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
      labels: {},
    }
    const result = serviceFormSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('name')
    }
  })

  it('rejects service with no upstreams', () => {
    const input = {
      name: 'test',
      lbPolicy: 'LB_POLICY_ROUND_ROBIN',
      upstreams: [],
      activeHealthCheck: { enabled: false, path: '', intervalSeconds: 0, timeoutSeconds: 0, healthyThreshold: 0, unhealthyThreshold: 0, expectedStatuses: [] },
      passiveHealthCheck: { enabled: false, failureWindow: '', maxFailures: 0, latencyThreshold: '', unhealthyStatuses: [] },
      timeouts: { dial: '', responseHeader: '', idle: '' },
      retries: { maxAttempts: 0, retryStatuses: [] },
      connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
      labels: {},
    }
    const result = serviceFormSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('validates upstream address is required', () => {
    const result = upstreamSchema.safeParse({ address: '', weight: 1, tls: 'TLS_MODE_OFF' })
    expect(result.success).toBe(false)
  })

  it('validates upstream weight must be non-negative', () => {
    const result = upstreamSchema.safeParse({ address: '10.0.0.1:8080', weight: -1, tls: 'TLS_MODE_OFF' })
    expect(result.success).toBe(false)
  })

  it('validates active health check path when enabled', () => {
    const result = activeHealthCheckSchema.safeParse({
      enabled: true, path: '', intervalSeconds: 10, timeoutSeconds: 5,
      healthyThreshold: 2, unhealthyThreshold: 3, expectedStatuses: [200],
    })
    expect(result.success).toBe(false)
  })

  it('accepts disabled health check with empty path', () => {
    const result = activeHealthCheckSchema.safeParse({
      enabled: false, path: '', intervalSeconds: 0, timeoutSeconds: 0,
      healthyThreshold: 0, unhealthyThreshold: 0, expectedStatuses: [],
    })
    expect(result.success).toBe(true)
  })
})
