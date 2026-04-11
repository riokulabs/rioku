import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useEntitySearch } from '../use-entity-search'
import { createWrapper } from '@/test/utils'

// Mock API responses
const mockConfig = {
  version: '42',
  routes: [
    {
      id: 'route-1',
      name: 'api-v1',
      matchers: [{ hosts: ['api.example.com'], paths: [{ type: 'TYPE_PREFIX', value: '/v1/' }] }],
      serviceId: 'svc-1',
      policyIds: [],
      enabled: true,
      labels: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'route-2',
      name: 'web-frontend',
      matchers: [{ hosts: ['www.example.com'] }],
      serviceId: 'svc-2',
      policyIds: [],
      enabled: true,
      labels: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  services: [
    {
      id: 'svc-1',
      name: 'api-backend',
      upstreams: [{ id: 'u1', address: '10.0.0.1:8080', weight: 1, tls: 'off', healthy: true }],
      lbPolicy: 'round_robin',
      healthCheck: null,
      labels: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  policies: [
    {
      id: 'pol-1',
      name: 'Global Rate Limit',
      type: 'POLICY_TYPE_RATE_LIMIT',
      config: {},
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
}

const mockUsers = [
  {
    id: 'user-1',
    username: 'admin',
    displayName: 'Root Admin',
    email: 'admin@example.com',
    roles: ['admin'],
    permissions: ['*'],
    totpEnabled: false,
    forcePasswordChange: false,
    status: 'active',
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
]

const mockKeys = [
  {
    id: 'key-1',
    name: 'Production API Key',
    prefix: 'rku_prod_',
    scopes: ['*'],
    expiresAt: '2027-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
]

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    if (urlStr.includes('/config')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockConfig),
      } as Response)
    }
    if (urlStr.includes('/auth/users')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockUsers),
      } as Response)
    }
    if (urlStr.includes('/keys')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockKeys),
      } as Response)
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response)
  }))
})

describe('useEntitySearch', () => {
  it('returns empty results for empty query', () => {
    const { result } = renderHook(() => useEntitySearch(''), {
      wrapper: createWrapper(),
    })
    expect(result.current.results).toEqual([])
  })

  it('filters routes by name', async () => {
    const { result } = renderHook(() => useEntitySearch('api-v1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.results.some((r) => r.type === 'route' && r.name === 'api-v1')).toBe(true)
    })
  })

  it('filters routes by host', async () => {
    const { result } = renderHook(() => useEntitySearch('www.example'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.results.some((r) => r.type === 'route' && r.name === 'web-frontend')).toBe(true)
    })
  })

  it('filters services by name', async () => {
    const { result } = renderHook(() => useEntitySearch('api-backend'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.results.some((r) => r.type === 'service' && r.name === 'api-backend')).toBe(true)
    })
  })

  it('filters policies by name', async () => {
    const { result } = renderHook(() => useEntitySearch('rate limit'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.results.some((r) => r.type === 'policy' && r.name === 'Global Rate Limit')).toBe(true)
    })
  })

  it('filters policies by type', async () => {
    const { result } = renderHook(() => useEntitySearch('RATE_LIMIT'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.results.some((r) => r.type === 'policy')).toBe(true)
    })
  })

  it('filters users by username', async () => {
    const { result } = renderHook(() => useEntitySearch('admin'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.results.some((r) => r.type === 'user' && r.name === 'Root Admin')).toBe(true)
    })
  })

  it('filters users by email', async () => {
    const { result } = renderHook(() => useEntitySearch('admin@example'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.results.some((r) => r.type === 'user')).toBe(true)
    })
  })

  it('filters API keys by name', async () => {
    const { result } = renderHook(() => useEntitySearch('Production'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.results.some((r) => r.type === 'apiKey' && r.name === 'Production API Key')).toBe(true)
    })
  })

  it('filters API keys by prefix', async () => {
    const { result } = renderHook(() => useEntitySearch('rku_prod'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.results.some((r) => r.type === 'apiKey')).toBe(true)
    })
  })

  it('returns results from multiple entity types', async () => {
    const { result } = renderHook(() => useEntitySearch('api'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      const types = new Set(result.current.results.map((r) => r.type))
      expect(types.size).toBeGreaterThan(1)
    })
  })
})
