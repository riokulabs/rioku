// Typed REST API client for the Rioku daemon.

// Mock fallback is lazily imported to avoid pulling mock data into the critical path.
// See src/lib/mock-fallback.ts for the mapping of unimplemented endpoints to mock data.
let _fallback: ((path: string, params?: Record<string, string>) => unknown | undefined) | null = null
async function loadFallback() {
  if (_fallback) return _fallback
  try {
    const mod = await import('./mock-fallback')
    _fallback = mod.getFallbackData
    return _fallback
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Domain types (matching proto JSON output)
// ---------------------------------------------------------------------------

export interface PathMatcher {
  type: string
  value: string
}

export interface HeaderMatcher {
  name: string
  value: string
  invert?: boolean
}

export interface Matcher {
  hosts?: string[]
  paths?: PathMatcher[]
  methods?: string[]
  headers?: HeaderMatcher[]
}

export interface Route {
  id: string
  name: string
  matchers: Matcher[]
  serviceId: string
  policyIds: string[]
  enabled: boolean
  labels: Record<string, string> | null
  createdAt: string
  updatedAt: string
  // NEEDS BACKEND -- not in proto yet, used for UI placeholders
  // forceTls?: boolean
  // minTlsVersion?: string
  // clientAuth?: string
  // priority?: number
  // streamingEnabled?: boolean
}

export interface Upstream {
  id: string
  address: string
  weight: number
  tls: string
  healthy: boolean
}

export interface HealthCheck {
  enabled: boolean
  path: string
  intervalSeconds: number
  timeoutSeconds: number
}

export interface Service {
  id: string
  name: string
  upstreams: Upstream[]
  lbPolicy: string
  healthCheck: HealthCheck | null
  labels: Record<string, string> | null
  createdAt: string
  updatedAt: string
}

export interface Policy {
  id: string
  name: string
  type: string
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ConfigSnapshot {
  version: string
  routes: Route[]
  services: Service[]
  policies: Policy[]
}

export interface SubsystemHealth {
  status: string
  message: string
}

export interface HealthStatus {
  overall: string
  store: SubsystemHealth
  caddy: SubsystemHealth
  version: string
  uptimeSeconds: number
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  scopes: string[]
  expiresAt: string
  createdAt: string
}

export interface AuditEntry {
  id: string
  actor: string
  entityType: string
  entityId: string
  operation: string
  diff: Record<string, unknown> | null
  beforeValues?: Record<string, unknown>
  afterValues?: Record<string, unknown>
  configVersion: number
  occurredAt: string
}

export interface ApiError {
  type: string
  title: string
  status: number
  detail: string
  instance: string
}

// --- Trace detail types (enriched from TrafficService) ---

export interface PolicyDecision {
  policyId: string
  policyName: string
  policyType: string
  result: 'pass' | 'fail' | 'skip'
  detail?: string
  rateLimitRemaining?: number
}

export interface TraceIdentity {
  actorType: 'api_key' | 'agent' | 'user' | 'anonymous'
  actorId?: string
  sessionId?: string
  apiKeyPrefix?: string
}

export interface TraceAIFields {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  estimatedCostUsd: number
  finishReason: string
  toolCalls?: string[]
}

export interface TraceOTel {
  traceId: string
  spanId: string
  externalViewerUrl?: string
}

export interface TraceDetail {
  id: string
  timestamp: string
  // REQUEST
  method: string
  path: string
  host: string
  requestHeaders: Record<string, string>
  queryParams: Record<string, string>
  // RESPONSE
  status: number
  responseHeaders: Record<string, string>
  responseSize: number
  // TIMING
  totalDurationMs: number
  upstreamDurationMs: number
  overheadMs: number
  // ROUTING
  routeId: string
  routeName: string
  serviceId: string
  serviceName: string
  upstream: string
  // POLICIES
  policies: PolicyDecision[]
  // IDENTITY
  identity: TraceIdentity | null
  // AI
  ai: TraceAIFields | null
  // OTEL
  otel: TraceOTel | null
}

// --- Plugin detail types ---

export interface PluginConfig {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select'
  label: string
  description?: string
  value: unknown
  options?: string[]
}

export interface PluginRoute {
  routeId: string
  routeName: string
  policyId?: string
}

export interface PluginChangelogEntry {
  version: string
  date: string
  changes: string[]
}

export interface PluginDetail {
  id: string
  name: string
  type: string
  status: 'active' | 'disabled'
  version: string
  description: string
  config: PluginConfig[]
  dependentRoutes: PluginRoute[]
  changelog: PluginChangelogEntry[]
  rawConfig: Record<string, unknown>
}

// --- Certificate types ---

export interface CertificateInfo {
  id: string
  domain: string
  issuer: string
  expiresAt: string
  issuedAt: string
  status: 'valid' | 'expiring' | 'expired' | 'revoked' | 'pending'
  sans: string[]
  serialNumber: string
  fingerprint: string
  acmeProvider?: string
  autoRenew: boolean
}

export interface AcmeConfig {
  provider: 'letsencrypt' | 'zerossl'
  email: string
  dnsProvider?: string
  onDemandEnabled: boolean
}

// --- AI / Agent session types ---

export interface AgentSession {
  sessionId: string
  agentIdentity: string
  turns: number
  totalTokens: number
  estimatedCostUsd: number
  status: 'active' | 'completed' | 'error'
  startedAt: string
  lastActivityAt: string
}

// --- Node / Cluster detail types ---

export interface NodeMetrics {
  cpuPercent: number
  memoryUsedMb: number
  memoryTotalMb: number
  goroutines: number
  openConnections: number
  requestsPerSecond: number
}

export interface NodeCertStatus {
  domain: string
  issuer: string
  expiresAt: string
  daysUntilExpiry: number
  status: 'valid' | 'expiring' | 'expired'
}

export interface SyncEvent {
  timestamp: string
  type: 'config_push' | 'config_pull' | 'cert_sync' | 'health_check'
  status: 'success' | 'failure'
  detail?: string
}

export interface NodeDetail {
  name: string
  role: 'bootstrap' | 'member'
  health: string
  daemon_version: string
  caddy_version: string
  store_mode: string
  last_seen: string
  address?: string
  metrics?: NodeMetrics
  certificates?: NodeCertStatus[]
  recentSyncEvents?: SyncEvent[]
}

// --- Auth / Session types ---

export interface SessionInfo {
  id: string
  createdAt: string
  lastActive: string
  expiresAt: string
  ipAddress: string
  userAgent?: string
}

export interface UserInfo {
  id: string
  username: string
  displayName: string | null
  email: string | null
  roles: string[]
  permissions: string[]
  totpEnabled: boolean
  forcePasswordChange: boolean
  status: 'active' | 'suspended' | 'locked'
  lastLogin: string | null
  createdAt: string
}

export interface MeResponse {
  session: SessionInfo
  user: UserInfo
}

// --- RBAC types ---

export interface Permission {
  id: string
  resource: string
  action: string
  description: string
}

export interface Role {
  id: string
  name: string
  description: string
  isBuiltin: boolean
  permissions: string[]
  createdAt: string
  updatedAt: string
}

// Expanded user model (Phase 3 — some fields need backend)
export interface ExpandedUser extends UserInfo {
  firstName?: string | null
  lastName?: string | null
  title?: string | null
  department?: string | null
  phone?: string | null
  timezone?: string | null
  locale?: string | null
  ssoProvider?: string | null
  ssoSubject?: string | null
  loginCount?: number
  lastLoginIp?: string | null
}

// Permission rule for granular RBAC
export interface PermissionRule {
  id: string
  resource: string
  actions: string[]
  scope: 'all' | 'owned' | 'labeled' | 'specific'
  scopeValue?: string
  effect: 'allow' | 'deny'
}

// Expanded role with hierarchy
export interface ExpandedRole extends Role {
  parentRoleIds?: string[]
  childRoleIds?: string[]
  memberCount?: number
  rules?: PermissionRule[]
}

// Access policy (conditional access rules)
export interface AccessPolicy {
  id: string
  name: string
  description: string
  effect: 'allow' | 'deny'
  targetType: 'roles' | 'users'
  targetIds: string[]
  conditions: AccessCondition[]
  priority: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AccessCondition {
  type: 'time' | 'ip' | 'mfa' | 'geo' | 'device' | 'custom'
  config: Record<string, unknown>
}

// --- Settings types ---

export interface GeneralSettingsResponse {
  instanceName: string
  dataDirectory: string
  logLevel: string
  daemonVersion: string
  caddyVersion: string
}

export interface NetworkSettingsResponse {
  trustedProxies: string[]
  clientIpHeaders: string[]
  strictMode: boolean
  listenAddresses: {
    grpc: string
    rest: string
    caddyHttp: string
    caddyHttps: string
    admin: string
  }
}

// CertificateInfo defined above (with full fields)

export interface TlsSettingsResponse {
  acmeProvider: string
  dnsChallengeProvider: string
  dnsChallengeCredentials: Record<string, string>
  onDemandTls: boolean
  onDemandRateInterval: string
  onDemandRateBurst: number
  defaultMinTlsVersion: string
  certificates: CertificateInfo[]
}

export interface ObservabilitySettingsResponse {
  traceSamplingRate: number
  alwaysTraceErrors: boolean
  alwaysTraceAi: boolean
  alwaysTraceSlowRequests: boolean
  slowRequestThresholdMs: number
  retentionRawTraces: string
  retentionAggregatedStats: string
  retentionAiSessions: string
  storageBackend: string
  storageUsedBytes: number
  storageMaxBytes: number
  ipMasking: boolean
  ipMaskPrefixLength: number
  queryParamRedaction: string[]
  cookieRedaction: string[]
  customPiiRegexes: string[]
  prometheusEnabled: boolean
  otelExporterEndpoint: string
}

export interface MigrationInfo {
  version: number
  name: string
  appliedAt: string
  status: 'applied' | 'pending' | 'failed'
}

export interface ConfigStoreSettingsResponse {
  backendType: string
  connectionInfo: string
  configVersion: number
  storeHealth: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  migrations: MigrationInfo[]
}

export interface AuthSettingsResponse {
  sessionCookieLifetime: string
  sessionIdleTimeout: string
  maxConcurrentSessions: number
  passwordMinLength: number
  passwordRequireUppercase: boolean
  passwordRequireLowercase: boolean
  passwordRequireNumber: boolean
  passwordRequireSpecial: boolean
  passwordMaxAgeDays: number
  lockoutMaxAttempts: number
  lockoutDuration: string
  lockoutResetWindow: string
  totpIssuerName: string
  totpEnforceForAll: boolean
  bruteForceRateLimit: number
}

export interface RotationHistoryInfo {
  id: string
  type: 'ca' | 'node' | 'db-client'
  rotatedAt: string
  reason: string
  actor: string
}

export interface PkiSettingsResponse {
  caAlgorithm: string
  caValidityDays: number
  caExpiresAt: string
  caFingerprint: string
  nodeCertExpiresAt: string
  nodeCertSans: string[]
  autoRotationThresholdDays: number
  dbClientCertStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  rotationHistory: RotationHistoryInfo[]
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const BASE = '/api/v1'

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    // For 404s on endpoints not yet implemented, try mock data fallback
    if (res.status === 404 || res.status === 500) {
      const fallbackFn = await loadFallback()
      if (fallbackFn) {
        const mockData = fallbackFn(path, params)
        if (mockData !== undefined) return mockData as T
      }
    }
    let error: ApiError
    try {
      error = await res.json()
    } catch {
      error = {
        type: 'about:blank',
        title: res.statusText,
        status: res.status,
        detail: `Request failed: ${method} ${path}`,
        instance: path,
      }
    }
    throw error
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** Fetch a single route by ID from the config snapshot. */
export async function fetchRouteById(id: string): Promise<Route | undefined> {
  const config = await request<ConfigSnapshot>('GET', '/config')
  return config.routes.find((r) => r.id === id)
}

/** Fetch a single service by ID from the config snapshot. */
export async function fetchServiceById(id: string): Promise<Service | undefined> {
  const config = await request<ConfigSnapshot>('GET', '/config')
  return config.services.find((s) => s.id === id)
}

/** Fetch all policies (for SearchableMultiSelect options). */
export async function fetchPolicies(): Promise<Policy[]> {
  const config = await request<ConfigSnapshot>('GET', '/config')
  return config.policies
}

/** Fetch all services (for SearchableSelect options). */
export async function fetchServices(): Promise<Service[]> {
  const config = await request<ConfigSnapshot>('GET', '/config')
  return config.services
}

export const apiClient = {
  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return request<T>('GET', path, undefined, params)
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('POST', path, body)
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PATCH', path, body)
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PUT', path, body)
  },
  del<T>(path: string): Promise<T> {
    return request<T>('DELETE', path)
  },
}
