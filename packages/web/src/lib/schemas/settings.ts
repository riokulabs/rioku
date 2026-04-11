import { z } from 'zod'

// --- General settings ---
export const generalSettingsSchema = z.object({
  instanceName: z.string().min(1, 'Instance name is required').max(128),
  dataDirectory: z.string(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  daemonVersion: z.string(),
  caddyVersion: z.string(),
})
export type GeneralSettings = z.infer<typeof generalSettingsSchema>

// --- Network settings ---
const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
export const networkSettingsSchema = z.object({
  trustedProxies: z.array(z.string().regex(cidrRegex, 'Invalid CIDR notation')),
  clientIpHeaders: z.array(z.string().min(1)),
  strictMode: z.boolean(),
  listenAddresses: z.object({
    grpc: z.string(),
    rest: z.string(),
    caddyHttp: z.string(),
    caddyHttps: z.string(),
    admin: z.string(),
  }),
})
export type NetworkSettings = z.infer<typeof networkSettingsSchema>

// --- TLS & Certificates ---
export const tlsSettingsSchema = z.object({
  acmeProvider: z.enum(['letsencrypt', 'zerossl']),
  dnsChallengeProvider: z.enum([
    'none', 'cloudflare', 'route53', 'gcloud', 'azure', 'digitalocean',
  ]),
  dnsChallengeCredentials: z.record(z.string(), z.string()).optional(),
  onDemandTls: z.boolean(),
  onDemandRateInterval: z.string().optional(),
  onDemandRateBurst: z.number().int().min(0).optional(),
  defaultMinTlsVersion: z.enum(['1.2', '1.3']),
})
export type TlsSettings = z.infer<typeof tlsSettingsSchema>

export const certificateSchema = z.object({
  domain: z.string(),
  issuer: z.string(),
  expiresAt: z.string(),
  status: z.enum(['valid', 'expiring', 'expired', 'revoked']),
})
export type Certificate = z.infer<typeof certificateSchema>

// --- Observability ---
export const observabilitySettingsSchema = z.object({
  traceSamplingRate: z.number().min(1).max(100),
  alwaysTraceErrors: z.boolean(),
  alwaysTraceAi: z.boolean(),
  alwaysTraceSlowRequests: z.boolean(),
  slowRequestThresholdMs: z.number().int().min(0),
  retentionRawTraces: z.string(),
  retentionAggregatedStats: z.string(),
  retentionAiSessions: z.string(),
  storageBackend: z.string(),
  storageUsedBytes: z.number(),
  storageMaxBytes: z.number(),
  ipMasking: z.boolean(),
  ipMaskPrefixLength: z.number().int().min(0).max(128).optional(),
  queryParamRedaction: z.array(z.string()),
  cookieRedaction: z.array(z.string()),
  customPiiRegexes: z.array(z.string()),
  prometheusEnabled: z.boolean(),
  otelExporterEndpoint: z.string().optional(),
})
export type ObservabilitySettings = z.infer<typeof observabilitySettingsSchema>

// --- Config Store ---
export const configStoreSettingsSchema = z.object({
  backendType: z.string(),
  connectionInfo: z.string(),
  configVersion: z.number(),
  storeHealth: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
})
export type ConfigStoreSettings = z.infer<typeof configStoreSettingsSchema>

export const migrationEntrySchema = z.object({
  version: z.number(),
  name: z.string(),
  appliedAt: z.string(),
  status: z.enum(['applied', 'pending', 'failed']),
})
export type MigrationEntry = z.infer<typeof migrationEntrySchema>

// --- Authentication ---
export const authSettingsSchema = z.object({
  sessionCookieLifetime: z.string(),
  sessionIdleTimeout: z.string(),
  maxConcurrentSessions: z.number().int().min(1),
  passwordMinLength: z.number().int().min(8).max(128),
  passwordRequireUppercase: z.boolean(),
  passwordRequireLowercase: z.boolean(),
  passwordRequireNumber: z.boolean(),
  passwordRequireSpecial: z.boolean(),
  passwordMaxAgeDays: z.number().int().min(0),
  lockoutMaxAttempts: z.number().int().min(1),
  lockoutDuration: z.string(),
  lockoutResetWindow: z.string(),
  totpIssuerName: z.string().min(1),
  totpEnforceForAll: z.boolean(),
  bruteForceRateLimit: z.number().int().min(0),
})
export type AuthSettings = z.infer<typeof authSettingsSchema>

// --- PKI ---
export const pkiSettingsSchema = z.object({
  caAlgorithm: z.string(),
  caValidityDays: z.number(),
  caExpiresAt: z.string(),
  caFingerprint: z.string(),
  nodeCertExpiresAt: z.string(),
  nodeCertSans: z.array(z.string()),
  autoRotationThresholdDays: z.number().int().min(1),
  dbClientCertStatus: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
})
export type PkiSettings = z.infer<typeof pkiSettingsSchema>

export const rotationHistoryEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['ca', 'node', 'db-client']),
  rotatedAt: z.string(),
  reason: z.string(),
  actor: z.string(),
})
export type RotationHistoryEntry = z.infer<typeof rotationHistoryEntrySchema>

// --- Danger Zone actions ---
export const dangerZoneActions = [
  {
    id: 'reset-config',
    confirmPhrase: 'reset all configuration',
  },
  {
    id: 'rotate-token',
    confirmPhrase: 'rotate bootstrap token',
  },
  {
    id: 'purge-traces',
    confirmPhrase: 'purge all traces',
  },
  {
    id: 'factory-reset',
    confirmPhrase: 'factory reset rioku',
  },
] as const
