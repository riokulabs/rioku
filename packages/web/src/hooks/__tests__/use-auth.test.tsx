import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { MeResponse } from '@/lib/api'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockMeResponse: MeResponse = {
  session: {
    id: 'sess-1',
    createdAt: '2026-01-01T00:00:00Z',
    lastActive: '2026-01-01T01:00:00Z',
    expiresAt: '2026-01-02T00:00:00Z',
    ipAddress: '127.0.0.1',
  },
  user: {
    id: 'user-1',
    username: 'testadmin',
    displayName: 'Test Admin',
    email: 'admin@test.com',
    roles: ['admin'],
    permissions: ['routes:read', 'routes:write', 'users:read', 'users:*'],
    totpEnabled: false,
    forcePasswordChange: false,
    status: 'active',
    lastLogin: '2026-01-01T00:00:00Z',
    createdAt: '2025-01-01T00:00:00Z',
  },
}

describe('use-auth hooks', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('useSession', () => {
    it('returns session data on successful /auth/me fetch', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useSession } = await import('../use-auth')
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(mockMeResponse)
    })

    it('enters error state when /auth/me returns 401', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
      })

      const { useSession } = await import('../use-auth')
      const { result } = renderHook(() => useSession(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isError).toBe(true))
    })

    it('sends credentials: include', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useSession } = await import('../use-auth')
      renderHook(() => useSession(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          '/api/v1/auth/me',
          expect.objectContaining({ credentials: 'include' }),
        )
      })
    })
  })

  describe('useCurrentUser', () => {
    it('returns user info when session is loaded', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useCurrentUser } = await import('../use-auth')
      const { result } = renderHook(() => useCurrentUser(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current).not.toBeNull())
      expect(result.current?.username).toBe('testadmin')
    })

    it('returns null when session is not loaded', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
      })

      const { useCurrentUser } = await import('../use-auth')
      const { result } = renderHook(() => useCurrentUser(), {
        wrapper: createWrapper(),
      })

      // Initially null before fetch resolves
      expect(result.current).toBeNull()
    })
  })

  describe('useHasPermission', () => {
    it('returns true for exact permission match', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useHasPermission } = await import('../use-auth')
      const { result } = renderHook(() => useHasPermission('routes:read'), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current).toBe(true))
    })

    it('returns true for wildcard permission match', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useHasPermission } = await import('../use-auth')
      // User has 'users:*', so 'users:write' should match
      const { result } = renderHook(() => useHasPermission('users:write'), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current).toBe(true))
    })

    it('returns false for missing permission', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      })

      const { useHasPermission } = await import('../use-auth')
      const { result } = renderHook(() => useHasPermission('admin:delete'), {
        wrapper: createWrapper(),
      })

      // Initially false (no data yet), stays false after load
      await waitFor(() => expect(result.current).toBe(false))
    })

    it('returns true when user has wildcard (*) permission', async () => {
      const superAdminResponse = {
        ...mockMeResponse,
        user: { ...mockMeResponse.user, permissions: ['*'] },
      }
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(superAdminResponse),
      })

      const { useHasPermission } = await import('../use-auth')
      const { result } = renderHook(
        () => useHasPermission('anything:at:all'),
        { wrapper: createWrapper() },
      )

      await waitFor(() => expect(result.current).toBe(true))
    })
  })
})
