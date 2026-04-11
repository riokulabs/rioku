import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useRouteMutations, useServiceMutations } from '../use-config-mutations'
import type { ConfigSnapshot } from '@/lib/api'

// Mock the apiClient module
vi.mock('@/lib/api', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({}),
  },
}))

const mockConfig: ConfigSnapshot = {
  version: '1',
  routes: [
    {
      id: 'route-1',
      name: 'test-route',
      matchers: [],
      serviceId: 'svc-1',
      policyIds: [],
      enabled: true,
      labels: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'route-2',
      name: 'other-route',
      matchers: [],
      serviceId: 'svc-1',
      policyIds: [],
      enabled: false,
      labels: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  services: [
    {
      id: 'svc-1',
      name: 'test-service',
      upstreams: [],
      lbPolicy: 'round_robin',
      healthCheck: null,
      labels: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  policies: [],
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  // Pre-populate config data for optimistic update tests
  queryClient.setQueryData(['config'], mockConfig)
  return { wrapper: function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }, queryClient }
}

describe('useRouteMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides save, delete, and toggle mutations', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRouteMutations(), { wrapper })
    expect(result.current.saveMutation).toBeDefined()
    expect(result.current.deleteMutation).toBeDefined()
    expect(result.current.toggleMutation).toBeDefined()
  })

  it('save mutation calls apiClient.post with UPSERT', async () => {
    const { apiClient } = await import('@/lib/api')
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRouteMutations(), { wrapper })
    result.current.saveMutation.mutate({ name: 'test', enabled: true })
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/config',
      expect.objectContaining({
        route: expect.objectContaining({ action: 'UPSERT' }),
      }),
    ))
  })

  it('toggle mutation immediately updates cache (optimistic)', async () => {
    const { wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useRouteMutations(), { wrapper })

    act(() => {
      result.current.toggleMutation.mutate({ id: 'route-1', enabled: true })
    })

    // Optimistic update should flip enabled to false immediately
    await waitFor(() => {
      const data = queryClient.getQueryData<ConfigSnapshot>(['config'])
      const route = data?.routes.find((r) => r.id === 'route-1')
      expect(route?.enabled).toBe(false)
    })
  })

  it('delete mutation immediately removes route from cache (optimistic)', async () => {
    const { wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useRouteMutations(), { wrapper })

    act(() => {
      result.current.deleteMutation.mutate('route-1')
    })

    // Optimistic update should remove route-1 immediately
    await waitFor(() => {
      const data = queryClient.getQueryData<ConfigSnapshot>(['config'])
      expect(data?.routes.find((r) => r.id === 'route-1')).toBeUndefined()
      expect(data?.routes).toHaveLength(1)
    })
  })

  it('toggle mutation reverts on error', async () => {
    const { apiClient } = await import('@/lib/api')
    ;(apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'))

    const { wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useRouteMutations(), { wrapper })

    act(() => {
      result.current.toggleMutation.mutate({ id: 'route-1', enabled: true })
    })

    // Wait for error handler to revert
    await waitFor(() => {
      expect(result.current.toggleMutation.isError).toBe(true)
    })

    // Should revert to original
    const data = queryClient.getQueryData<ConfigSnapshot>(['config'])
    const route = data?.routes.find((r) => r.id === 'route-1')
    expect(route?.enabled).toBe(true)
  })

  it('delete mutation reverts on error', async () => {
    const { apiClient } = await import('@/lib/api')
    ;(apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'))

    const { wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useRouteMutations(), { wrapper })

    act(() => {
      result.current.deleteMutation.mutate('route-1')
    })

    // Wait for error handler to revert
    await waitFor(() => {
      expect(result.current.deleteMutation.isError).toBe(true)
    })

    // Should revert -- route-1 should be back
    const data = queryClient.getQueryData<ConfigSnapshot>(['config'])
    expect(data?.routes.find((r) => r.id === 'route-1')).toBeDefined()
    expect(data?.routes).toHaveLength(2)
  })
})

describe('useServiceMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides save and delete mutations', () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useServiceMutations(), { wrapper })
    expect(result.current.saveMutation).toBeDefined()
    expect(result.current.deleteMutation).toBeDefined()
  })

  it('delete mutation immediately removes service from cache (optimistic)', async () => {
    const { wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useServiceMutations(), { wrapper })

    act(() => {
      result.current.deleteMutation.mutate('svc-1')
    })

    await waitFor(() => {
      const data = queryClient.getQueryData<ConfigSnapshot>(['config'])
      expect(data?.services.find((s) => s.id === 'svc-1')).toBeUndefined()
    })
  })

  it('delete mutation reverts on error', async () => {
    const { apiClient } = await import('@/lib/api')
    ;(apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'))

    const { wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useServiceMutations(), { wrapper })

    act(() => {
      result.current.deleteMutation.mutate('svc-1')
    })

    await waitFor(() => {
      expect(result.current.deleteMutation.isError).toBe(true)
    })

    const data = queryClient.getQueryData<ConfigSnapshot>(['config'])
    expect(data?.services.find((s) => s.id === 'svc-1')).toBeDefined()
  })
})
