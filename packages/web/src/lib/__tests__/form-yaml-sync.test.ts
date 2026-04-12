import { describe, it, expect } from 'vitest'
import {
  routeFormToYaml,
  yamlToRouteForm,
  serviceFormToYaml,
  yamlToServiceForm,
  policyConfigToYaml,
  yamlToPolicyConfig,
  labelsToKvPairs,
  kvPairsToLabels,
} from '../form-yaml-sync'
import type { RouteFormValues } from '@/lib/schemas/route'
import type { ServiceFormValues } from '@/lib/schemas/service'

describe('routeFormToYaml', () => {
  it('converts a minimal route form to YAML', () => {
    const values: RouteFormValues = {
      name: 'test-route',
      enabled: true,
      hosts: ['api.test.com'],
      paths: [{ type: 'TYPE_PREFIX', value: '/v1/' }],
      methods: ['GET', 'POST'],
      headers: [],
      targetType: 'service',
      serviceId: 'svc-123',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: ['pol-1'],
      labels: { env: 'test' },
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }

    const yaml = routeFormToYaml(values)
    expect(yaml).toContain('name: test-route')
    expect(yaml).toContain('enabled: true')
    expect(yaml).toContain('api.test.com')
    expect(yaml).toContain('TYPE_PREFIX')
    expect(yaml).toContain('/v1/')
    expect(yaml).toContain('svc-123')
    expect(yaml).toContain('pol-1')
    expect(yaml).toContain('env: test')
  })

  it('handles direct upstream target', () => {
    const values: RouteFormValues = {
      name: 'direct-route',
      enabled: true,
      hosts: [],
      paths: [{ type: 'TYPE_EXACT', value: '/health' }],
      methods: [],
      headers: [],
      targetType: 'direct',
      serviceId: '',
      directAddress: 'localhost:8080',
      directTls: 'TLS_MODE_AUTO',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }

    const yaml = routeFormToYaml(values)
    expect(yaml).toContain('localhost:8080')
    expect(yaml).toContain('TLS_MODE_AUTO')
    expect(yaml).not.toContain('serviceId')
  })

  it('omits empty arrays and empty labels', () => {
    const values: RouteFormValues = {
      name: 'minimal',
      enabled: true,
      hosts: [],
      paths: [{ type: 'TYPE_PREFIX', value: '/' }],
      methods: [],
      headers: [],
      targetType: 'service',
      serviceId: 'svc-1',
      directAddress: '',
      directTls: 'TLS_MODE_OFF',
      policyIds: [],
      labels: {},
      forceTls: false,
      minTlsVersion: '1.2',
      clientAuth: 'off',
    }

    const yaml = routeFormToYaml(values)
    // Should not contain empty arrays as "[]" or empty labels
    expect(yaml).not.toContain('hosts:')
    expect(yaml).not.toContain('methods:')
    expect(yaml).not.toContain('headers:')
    expect(yaml).not.toContain('policyIds:')
    expect(yaml).not.toContain('labels:')
  })
})

describe('yamlToRouteForm', () => {
  it('parses YAML back to route form values', () => {
    const yaml = `
name: test-route
enabled: true
matchers:
  - hosts:
      - api.test.com
    paths:
      - type: TYPE_PREFIX
        value: /v1/
    methods:
      - GET
      - POST
serviceId: svc-123
policyIds:
  - pol-1
labels:
  env: test
`
    const form = yamlToRouteForm(yaml)
    expect(form.name).toBe('test-route')
    expect(form.enabled).toBe(true)
    expect(form.hosts).toEqual(['api.test.com'])
    expect(form.paths).toEqual([{ type: 'TYPE_PREFIX', value: '/v1/' }])
    expect(form.methods).toEqual(['GET', 'POST'])
    expect(form.serviceId).toBe('svc-123')
    expect(form.targetType).toBe('service')
    expect(form.policyIds).toEqual(['pol-1'])
    expect(form.labels).toEqual({ env: 'test' })
  })

  it('handles direct upstream YAML', () => {
    const yaml = `
name: direct-route
enabled: true
matchers:
  - paths:
      - type: TYPE_EXACT
        value: /health
upstream:
  address: localhost:8080
  tls: TLS_MODE_AUTO
`
    const form = yamlToRouteForm(yaml)
    expect(form.targetType).toBe('direct')
    expect(form.directAddress).toBe('localhost:8080')
    expect(form.directTls).toBe('TLS_MODE_AUTO')
  })

  it('returns empty defaults for missing fields', () => {
    const yaml = `name: bare-minimum`
    const form = yamlToRouteForm(yaml)
    expect(form.name).toBe('bare-minimum')
    expect(form.hosts).toEqual([])
    expect(form.paths).toEqual([])
    expect(form.methods).toEqual([])
    expect(form.policyIds).toEqual([])
  })
})

describe('serviceFormToYaml', () => {
  it('converts service form to YAML', () => {
    const values: ServiceFormValues = {
      name: 'test-service',
      lbPolicy: 'LB_POLICY_ROUND_ROBIN',
      upstreams: [
        { address: '10.0.0.1:8080', weight: 3, tls: 'TLS_MODE_OFF' },
        { address: '10.0.0.2:8080', weight: 1, tls: 'TLS_MODE_AUTO' },
      ],
      activeHealthCheck: {
        enabled: true,
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
      transport: { tlsToUpstream: 'off', httpVersion: 'auto', keepAlive: true },
      labels: { team: 'backend' },
    }

    const yaml = serviceFormToYaml(values)
    expect(yaml).toContain('name: test-service')
    expect(yaml).toContain('LB_POLICY_ROUND_ROBIN')
    expect(yaml).toContain('10.0.0.1:8080')
    expect(yaml).toContain('10.0.0.2:8080')
    expect(yaml).toContain('path: /health')
    expect(yaml).toContain('team: backend')
  })

  it('omits disabled health check', () => {
    const values: ServiceFormValues = {
      name: 'no-health',
      lbPolicy: 'LB_POLICY_RANDOM',
      upstreams: [{ address: '10.0.0.1:8080', weight: 1, tls: 'TLS_MODE_OFF' }],
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
      transport: { tlsToUpstream: 'off', httpVersion: 'auto', keepAlive: true },
      labels: {},
    }

    const yaml = serviceFormToYaml(values)
    expect(yaml).not.toContain('healthCheck:')
  })
})

describe('yamlToServiceForm', () => {
  it('parses service YAML to form values', () => {
    const yaml = `
name: parsed-service
lbPolicy: LB_POLICY_LEAST_CONN
upstreams:
  - address: "10.0.0.1:8080"
    weight: 2
    tls: TLS_MODE_OFF
healthCheck:
  enabled: true
  path: /ready
  intervalSeconds: 15
  timeoutSeconds: 3
labels:
  env: staging
`
    const form = yamlToServiceForm(yaml)
    expect(form.name).toBe('parsed-service')
    expect(form.lbPolicy).toBe('LB_POLICY_LEAST_CONN')
    expect(form.upstreams).toHaveLength(1)
    expect(form.upstreams![0].address).toBe('10.0.0.1:8080')
    expect(form.activeHealthCheck!.enabled).toBe(true)
    expect(form.activeHealthCheck!.path).toBe('/ready')
    expect(form.labels).toEqual({ env: 'staging' })
  })
})

describe('policyConfigToYaml', () => {
  it('converts policy config to YAML with type and name', () => {
    const yaml = policyConfigToYaml('POLICY_TYPE_RATE_LIMIT', 'Global Rate Limit', {
      requestsPerWindow: 1000,
      windowUnit: 'minute',
      scope: 'per_ip',
    })
    expect(yaml).toContain('name: Global Rate Limit')
    expect(yaml).toContain('type: POLICY_TYPE_RATE_LIMIT')
    expect(yaml).toContain('requestsPerWindow: 1000')
    expect(yaml).toContain('windowUnit: minute')
    expect(yaml).toContain('scope: per_ip')
  })
})

describe('yamlToPolicyConfig', () => {
  it('parses policy YAML to type, name, and config', () => {
    const yaml = `
type: POLICY_TYPE_CORS
name: My CORS Policy
config:
  allowedOrigins:
    - https://example.com
  allowedMethods:
    - GET
    - POST
  allowCredentials: true
`
    const result = yamlToPolicyConfig(yaml)
    expect(result.type).toBe('POLICY_TYPE_CORS')
    expect(result.name).toBe('My CORS Policy')
    expect(result.config).toEqual({
      allowedOrigins: ['https://example.com'],
      allowedMethods: ['GET', 'POST'],
      allowCredentials: true,
    })
  })

  it('returns empty config for minimal YAML', () => {
    const yaml = `name: bare`
    const result = yamlToPolicyConfig(yaml)
    expect(result.name).toBe('bare')
    expect(result.config).toEqual({})
  })
})

describe('labelsToKvPairs', () => {
  it('converts labels record to KvPair array', () => {
    const pairs = labelsToKvPairs({ env: 'prod', team: 'platform' })
    expect(pairs).toEqual([
      { key: 'env', value: 'prod' },
      { key: 'team', value: 'platform' },
    ])
  })

  it('returns empty array for empty record', () => {
    const pairs = labelsToKvPairs({})
    expect(pairs).toEqual([])
  })
})

describe('kvPairsToLabels', () => {
  it('converts KvPair array to labels record', () => {
    const labels = kvPairsToLabels([
      { key: 'env', value: 'prod' },
      { key: 'team', value: 'platform' },
    ])
    expect(labels).toEqual({ env: 'prod', team: 'platform' })
  })

  it('ignores pairs with empty keys', () => {
    const labels = kvPairsToLabels([
      { key: '', value: 'ignored' },
      { key: 'valid', value: 'kept' },
      { key: '  ', value: 'also-ignored' },
    ])
    expect(labels).toEqual({ valid: 'kept' })
  })

  it('trims whitespace from keys', () => {
    const labels = kvPairsToLabels([
      { key: '  env  ', value: 'prod' },
    ])
    expect(labels).toEqual({ env: 'prod' })
  })

  it('returns empty record for empty array', () => {
    const labels = kvPairsToLabels([])
    expect(labels).toEqual({})
  })
})
