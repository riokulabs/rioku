import type {
  GeneralSettingsResponse,
  NetworkSettingsResponse,
  TlsSettingsResponse,
  ObservabilitySettingsResponse,
  ConfigStoreSettingsResponse,
  AuthSettingsResponse,
  PkiSettingsResponse,
} from '@/lib/api'

export const mockGeneralSettings: GeneralSettingsResponse = {
  instanceName: 'rioku-dev',
  dataDirectory: '/var/lib/rioku',
  logLevel: 'info',
  daemonVersion: '0.3.0-dev',
  caddyVersion: '2.9.1',
}

export const mockNetworkSettings: NetworkSettingsResponse = {
  trustedProxies: ['10.0.0.0/8', '172.16.0.0/12'],
  clientIpHeaders: ['X-Forwarded-For', 'X-Real-IP'],
  strictMode: false,
  listenAddresses: {
    grpc: ':7777',
    rest: ':7778',
    caddyHttp: ':80',
    caddyHttps: ':443',
    admin: ':2019',
  },
}

export const mockTlsSettings: TlsSettingsResponse = {
  acmeProvider: 'letsencrypt',
  dnsChallengeProvider: '',
  dnsChallengeCredentials: {},
  onDemandTls: false,
  onDemandRateInterval: '10m',
  onDemandRateBurst: 5,
  defaultMinTlsVersion: '1.2',
  certificates: [],  // Certificates are served from their own endpoint
}

export const mockObservabilitySettings: ObservabilitySettingsResponse = {
  traceSamplingRate: 0.1,
  alwaysTraceErrors: true,
  alwaysTraceAi: true,
  alwaysTraceSlowRequests: true,
  slowRequestThresholdMs: 1000,
  retentionRawTraces: '7d',
  retentionAggregatedStats: '90d',
  retentionAiSessions: '30d',
  storageBackend: 'sqlite',
  storageUsedBytes: 524288000,
  storageMaxBytes: 10737418240,
  ipMasking: true,
  ipMaskPrefixLength: 24,
  queryParamRedaction: ['api_key', 'token', 'secret'],
  cookieRedaction: ['session', 'auth_token'],
  customPiiRegexes: [],
  prometheusEnabled: true,
  otelExporterEndpoint: '',
}

export const mockConfigStoreSettings: ConfigStoreSettingsResponse = {
  backendType: 'sqlite',
  connectionInfo: '/var/lib/rioku/config.db',
  configVersion: 42,
  storeHealth: 'healthy',
  migrations: [
    { version: 1, name: 'initial_schema', appliedAt: '2026-01-01T00:00:00Z', status: 'applied' },
    { version: 2, name: 'add_policy_types', appliedAt: '2026-02-01T00:00:00Z', status: 'applied' },
    { version: 3, name: 'add_audit_trail', appliedAt: '2026-03-01T00:00:00Z', status: 'applied' },
    { version: 4, name: 'add_traffic_tables', appliedAt: '2026-04-01T00:00:00Z', status: 'applied' },
  ],
}

export const mockAuthSettings: AuthSettingsResponse = {
  sessionCookieLifetime: '12h',
  sessionIdleTimeout: '30m',
  maxConcurrentSessions: 5,
  passwordMinLength: 12,
  passwordRequireUppercase: true,
  passwordRequireLowercase: true,
  passwordRequireNumber: true,
  passwordRequireSpecial: true,
  passwordMaxAgeDays: 90,
  lockoutMaxAttempts: 5,
  lockoutDuration: '15m',
  lockoutResetWindow: '30m',
  totpIssuerName: 'Rioku',
  totpEnforceForAll: false,
  bruteForceRateLimit: 10,
}

export const mockPkiSettings: PkiSettingsResponse = {
  caAlgorithm: 'ECDSA-P256',
  caValidityDays: 365,
  caExpiresAt: '2027-03-28T00:00:00Z',
  caFingerprint: 'sha256:new1234567890abcdef',
  nodeCertExpiresAt: '2026-10-11T00:00:00Z',
  nodeCertSans: ['node-primary-01', '10.0.0.10'],
  autoRotationThresholdDays: 30,
  dbClientCertStatus: 'healthy',
  rotationHistory: [
    {
      id: 'rot-001',
      type: 'ca',
      rotatedAt: '2026-03-28T08:00:00Z',
      reason: 'Scheduled rotation',
      actor: 'admin',
    },
  ],
}
