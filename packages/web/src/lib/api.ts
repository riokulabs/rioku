// Typed REST API client for the Rioku daemon.

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
