import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useRouteMutations, useServiceMutations } from '../use-config-mutations'

// Mock the apiClient module
vi.mock('@/lib/api', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({}),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useRouteMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides save, delete, and toggle mutations', () => {
    const { result } = renderHook(() => useRouteMutations(), {
      wrapper: createWrapper(),
    })
    expect(result.current.saveMutation).toBeDefined()
    expect(result.current.deleteMutation).toBeDefined()
    expect(result.current.toggleMutation).toBeDefined()
  })

  it('save mutation calls apiClient.post with UPSERT', async () => {
    const { apiClient } = await import('@/lib/api')
    const { result } = renderHook(() => useRouteMutations(), {
      wrapper: createWrapper(),
    })
    result.current.saveMutation.mutate({ name: 'test', enabled: true })
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/config',
      expect.objectContaining({
        route: expect.objectContaining({ action: 'UPSERT' }),
      }),
    ))
  })
})

describe('useServiceMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides save and delete mutations', () => {
    const { result } = renderHook(() => useServiceMutations(), {
      wrapper: createWrapper(),
    })
    expect(result.current.saveMutation).toBeDefined()
    expect(result.current.deleteMutation).toBeDefined()
  })
})
