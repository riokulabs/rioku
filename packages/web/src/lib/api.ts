// Typed REST API client for the Rioku daemon.

// ---------------------------------------------------------------------------
// Domain types (matching proto JSON output)
// ---------------------------------------------------------------------------

export interface Matcher {
  host?: string[]
  path?: string[]
  method?: string[]
}

export interface Route {
  id: string
  name: string
  matchers: Matcher[]
  target_service: string
  enabled: boolean
  policy_ids: string[]
  created_at: string
  updated_at: string
}

export interface Upstream {
  address: string
  weight: number
  tls_mode: string
}

export interface Service {
  id: string
  name: string
  upstreams: Upstream[]
  lb_policy: string
  created_at: string
  updated_at: string
}

export interface Policy {
  id: string
  name: string
  type: string
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ConfigSnapshot {
  version: number
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
  expires_at: string
  created_at: string
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
  created_at: string
  last_active: string
  expires_at: string
  ip_address: string
  user_agent?: string
}

export interface UserInfo {
  id: string
  username: string
  display_name: string | null
  email: string | null
  roles: string[]
  permissions: string[]
  totp_enabled: boolean
  force_password_change: boolean
  status: 'active' | 'suspended' | 'locked'
  last_login: string | null
  created_at: string
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
  is_builtin: boolean
  permissions: string[]
  created_at: string
  updated_at: string
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
