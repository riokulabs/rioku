// Typed REST API client for the Rioku daemon.

import { getAuthHeader } from '@/lib/auth'

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
  uptime: number
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
  entity_type: string
  entity_id: string
  operation: string
  diff: Record<string, unknown> | null
  timestamp: string
  request_id: string
}

export interface ApiError {
  type: string
  title: string
  status: number
  detail: string
  instance: string
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

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...getAuthHeader(),
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
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

  // 204 No Content
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
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PUT', path, body)
  },
  del<T>(path: string): Promise<T> {
    return request<T>('DELETE', path)
  },
}
