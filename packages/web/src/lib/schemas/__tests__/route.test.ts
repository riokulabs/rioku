import { describe, it, expect } from 'vitest'
import {
  routeFormSchema,
  type RouteFormValues,
  pathMatcherSchema,
  headerMatcherSchema,
} from '../route'

describe('routeFormSchema', () => {
  it('accepts a valid minimal route', () => {
    const input: RouteFormValues = {
      name: 'api-gateway',
      enabled: true,
      hosts: [],
      paths: [{ type: 'TYPE_PREFIX', value: '/api' }],
      methods: [],
      headers: [],
      targetType: 'service',
      serviceId: 'svc-123',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }
    const result = routeFormSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const input = {
      name: '',
      enabled: true,
      hosts: [],
      paths: [],
      methods: [],
      headers: [],
      targetType: 'service',
      serviceId: 'svc-123',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }
    const result = routeFormSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('name')
    }
  })

  it('rejects service target without serviceId', () => {
    const input = {
      name: 'test',
      enabled: true,
      hosts: [],
      paths: [],
      methods: [],
      headers: [],
      targetType: 'service',
      serviceId: '',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }
    const result = routeFormSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('accepts direct upstream target', () => {
    const input: RouteFormValues = {
      name: 'direct-route',
      enabled: true,
      hosts: ['api.example.com'],
      paths: [],
      methods: ['GET', 'POST'],
      headers: [],
      targetType: 'direct',
      serviceId: '',
      directAddress: '10.0.1.10:8080',
      directTls: 'TLS_MODE_AUTO',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }
    const result = routeFormSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('validates path matcher type is one of the allowed values', () => {
    const result = pathMatcherSchema.safeParse({ type: 'INVALID', value: '/api' })
    expect(result.success).toBe(false)
  })

  it('rejects path matcher with empty value', () => {
    const result = pathMatcherSchema.safeParse({ type: 'TYPE_PREFIX', value: '' })
    expect(result.success).toBe(false)
  })

  it('validates header matcher requires name', () => {
    const result = headerMatcherSchema.safeParse({ name: '', value: 'bar', invert: false })
    expect(result.success).toBe(false)
  })

  it('accepts full header matcher', () => {
    const result = headerMatcherSchema.safeParse({ name: 'X-Custom', value: 'bar', invert: true })
    expect(result.success).toBe(true)
  })
})
