import { describe, it, expect } from 'vitest'
import {
  generalSettingsSchema,
  networkSettingsSchema,
  tlsSettingsSchema,
  observabilitySettingsSchema,
  configStoreSettingsSchema,
  authSettingsSchema,
  pkiSettingsSchema,
} from '../settings'

describe('generalSettingsSchema', () => {
  it('accepts valid general settings', () => {
    const result = generalSettingsSchema.safeParse({
      instanceName: 'production-gateway',
      dataDirectory: '/var/lib/rioku',
      logLevel: 'info',
      daemonVersion: '0.3.0',
      caddyVersion: '2.9.1',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty instance name', () => {
    const result = generalSettingsSchema.safeParse({
      instanceName: '',
      dataDirectory: '/var/lib/rioku',
      logLevel: 'info',
      daemonVersion: '0.3.0',
      caddyVersion: '2.9.1',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid log level', () => {
    const result = generalSettingsSchema.safeParse({
      instanceName: 'test',
      dataDirectory: '/var/lib/rioku',
      logLevel: 'trace',
      daemonVersion: '0.3.0',
      caddyVersion: '2.9.1',
    })
    expect(result.success).toBe(false)
  })
})

describe('networkSettingsSchema', () => {
  it('accepts valid CIDR in trustedProxies', () => {
    const result = networkSettingsSchema.safeParse({
      trustedProxies: ['10.0.0.0/8', '172.16.0.0/12'],
      clientIpHeaders: ['X-Forwarded-For'],
      strictMode: false,
      listenAddresses: {
        grpc: ':7777', rest: ':7778',
        caddyHttp: ':80', caddyHttps: ':443', admin: ':2019',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid CIDR notation', () => {
    const result = networkSettingsSchema.safeParse({
      trustedProxies: ['not-a-cidr'],
      clientIpHeaders: ['X-Forwarded-For'],
      strictMode: false,
      listenAddresses: {
        grpc: ':7777', rest: ':7778',
        caddyHttp: ':80', caddyHttps: ':443', admin: ':2019',
      },
    })
    expect(result.success).toBe(false)
  })

  it('accepts empty trustedProxies array', () => {
    const result = networkSettingsSchema.safeParse({
      trustedProxies: [],
      clientIpHeaders: [],
      strictMode: true,
      listenAddresses: {
        grpc: ':7777', rest: ':7778',
        caddyHttp: ':80', caddyHttps: ':443', admin: ':2019',
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('tlsSettingsSchema', () => {
  it('accepts valid TLS settings', () => {
    const result = tlsSettingsSchema.safeParse({
      acmeProvider: 'letsencrypt',
      dnsChallengeProvider: 'cloudflare',
      dnsChallengeCredentials: { apiToken: '***' },
      onDemandTls: false,
      defaultMinTlsVersion: '1.2',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid ACME provider', () => {
    const result = tlsSettingsSchema.safeParse({
      acmeProvider: 'custom',
      dnsChallengeProvider: 'none',
      onDemandTls: false,
      defaultMinTlsVersion: '1.2',
    })
    expect(result.success).toBe(false)
  })
})

describe('observabilitySettingsSchema', () => {
  it('accepts valid observability settings', () => {
    const result = observabilitySettingsSchema.safeParse({
      traceSamplingRate: 50,
      alwaysTraceErrors: true,
      alwaysTraceAi: true,
      alwaysTraceSlowRequests: false,
      slowRequestThresholdMs: 3000,
      retentionRawTraces: '7d',
      retentionAggregatedStats: '90d',
      retentionAiSessions: '30d',
      storageBackend: 'sqlite',
      storageUsedBytes: 104857600,
      storageMaxBytes: 1073741824,
      ipMasking: true,
      ipMaskPrefixLength: 24,
      queryParamRedaction: ['password', 'token'],
      cookieRedaction: ['session_id'],
      customPiiRegexes: [],
      prometheusEnabled: false,
      otelExporterEndpoint: '',
    })
    expect(result.success).toBe(true)
  })

  it('rejects sampling rate below 1', () => {
    const result = observabilitySettingsSchema.safeParse({
      traceSamplingRate: 0,
      alwaysTraceErrors: false,
      alwaysTraceAi: false,
      alwaysTraceSlowRequests: false,
      slowRequestThresholdMs: 3000,
      retentionRawTraces: '7d',
      retentionAggregatedStats: '90d',
      retentionAiSessions: '30d',
      storageBackend: 'sqlite',
      storageUsedBytes: 0,
      storageMaxBytes: 0,
      ipMasking: false,
      queryParamRedaction: [],
      cookieRedaction: [],
      customPiiRegexes: [],
      prometheusEnabled: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects sampling rate above 100', () => {
    const result = observabilitySettingsSchema.safeParse({
      traceSamplingRate: 150,
      alwaysTraceErrors: false,
      alwaysTraceAi: false,
      alwaysTraceSlowRequests: false,
      slowRequestThresholdMs: 3000,
      retentionRawTraces: '7d',
      retentionAggregatedStats: '90d',
      retentionAiSessions: '30d',
      storageBackend: 'sqlite',
      storageUsedBytes: 0,
      storageMaxBytes: 0,
      ipMasking: false,
      queryParamRedaction: [],
      cookieRedaction: [],
      customPiiRegexes: [],
      prometheusEnabled: false,
    })
    expect(result.success).toBe(false)
  })
})

describe('authSettingsSchema', () => {
  it('accepts valid authentication settings', () => {
    const result = authSettingsSchema.safeParse({
      sessionCookieLifetime: '24h',
      sessionIdleTimeout: '30m',
      maxConcurrentSessions: 5,
      passwordMinLength: 12,
      passwordRequireUppercase: true,
      passwordRequireLowercase: true,
      passwordRequireNumber: true,
      passwordRequireSpecial: false,
      passwordMaxAgeDays: 90,
      lockoutMaxAttempts: 5,
      lockoutDuration: '15m',
      lockoutResetWindow: '1h',
      totpIssuerName: 'Rioku Gateway',
      totpEnforceForAll: false,
      bruteForceRateLimit: 10,
    })
    expect(result.success).toBe(true)
  })

  it('rejects password min length below 8', () => {
    const result = authSettingsSchema.safeParse({
      sessionCookieLifetime: '24h',
      sessionIdleTimeout: '30m',
      maxConcurrentSessions: 5,
      passwordMinLength: 4,
      passwordRequireUppercase: false,
      passwordRequireLowercase: false,
      passwordRequireNumber: false,
      passwordRequireSpecial: false,
      passwordMaxAgeDays: 0,
      lockoutMaxAttempts: 5,
      lockoutDuration: '15m',
      lockoutResetWindow: '1h',
      totpIssuerName: 'Rioku',
      totpEnforceForAll: false,
      bruteForceRateLimit: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('pkiSettingsSchema', () => {
  it('accepts valid PKI settings', () => {
    const result = pkiSettingsSchema.safeParse({
      caAlgorithm: 'ecdsa-p256',
      caValidityDays: 3650,
      caExpiresAt: '2036-04-10T00:00:00Z',
      caFingerprint: 'SHA256:abc123...',
      nodeCertExpiresAt: '2027-04-10T00:00:00Z',
      nodeCertSans: ['node-1.rioku.local'],
      autoRotationThresholdDays: 30,
      dbClientCertStatus: 'healthy',
    })
    expect(result.success).toBe(true)
  })

  it('rejects auto-rotation threshold below 1', () => {
    const result = pkiSettingsSchema.safeParse({
      caAlgorithm: 'ecdsa-p256',
      caValidityDays: 3650,
      caExpiresAt: '2036-04-10T00:00:00Z',
      caFingerprint: 'SHA256:abc123...',
      nodeCertExpiresAt: '2027-04-10T00:00:00Z',
      nodeCertSans: [],
      autoRotationThresholdDays: 0,
      dbClientCertStatus: 'healthy',
    })
    expect(result.success).toBe(false)
  })
})

describe('configStoreSettingsSchema', () => {
  it('accepts valid config store settings', () => {
    const result = configStoreSettingsSchema.safeParse({
      backendType: 'sqlite',
      connectionInfo: '/var/lib/rioku/store.db',
      configVersion: 42,
      storeHealth: 'healthy',
    })
    expect(result.success).toBe(true)
  })
})
