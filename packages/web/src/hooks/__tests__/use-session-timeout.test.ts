import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionTimeout } from '../use-session-timeout'
import { createWrapper } from '@/test/utils'

// Mock useSession to return controlled session data
const mockSessionData = {
  session: {
    id: 'sess-1',
    createdAt: '2026-04-11T00:00:00Z',
    lastActive: '2026-04-11T00:00:00Z',
    expiresAt: '', // will be set per test
    ipAddress: '127.0.0.1',
  },
  user: {
    id: 'user-1',
    username: 'admin',
    displayName: 'Admin',
    email: 'admin@example.com',
    roles: ['admin'],
    permissions: ['*'],
    totpEnabled: false,
    forcePasswordChange: false,
    status: 'active' as const,
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
}

vi.mock('@/hooks/use-auth', () => ({
  useSession: vi.fn(() => ({
    data: mockSessionData,
    isLoading: false,
    isError: false,
  })),
}))

vi.mock('@/lib/api', () => ({
  apiClient: {
    post: vi.fn(() => Promise.resolve({})),
  },
}))

describe('useSessionTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns correct time remaining', () => {
    // Set expiry 10 minutes from now
    const now = Date.now()
    mockSessionData.session.expiresAt = new Date(now + 600_000).toISOString()

    const { result } = renderHook(() => useSessionTimeout(), {
      wrapper: createWrapper(),
    })

    expect(result.current.timeRemaining).toBeGreaterThanOrEqual(598)
    expect(result.current.timeRemaining).toBeLessThanOrEqual(600)
  })

  it('showWarning is false when > 5 min remain', () => {
    const now = Date.now()
    mockSessionData.session.expiresAt = new Date(now + 600_000).toISOString()

    const { result } = renderHook(() => useSessionTimeout(), {
      wrapper: createWrapper(),
    })

    expect(result.current.showWarning).toBe(false)
  })

  it('showWarning is true when <= 5 min remain', () => {
    const now = Date.now()
    mockSessionData.session.expiresAt = new Date(now + 200_000).toISOString()

    const { result } = renderHook(() => useSessionTimeout(), {
      wrapper: createWrapper(),
    })

    expect(result.current.showWarning).toBe(true)
  })

  it('isExpired is true when time is 0', () => {
    const now = Date.now()
    mockSessionData.session.expiresAt = new Date(now - 1000).toISOString()

    const { result } = renderHook(() => useSessionTimeout(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isExpired).toBe(true)
  })

  it('countdown decrements over time', () => {
    const now = Date.now()
    mockSessionData.session.expiresAt = new Date(now + 60_000).toISOString()

    const { result } = renderHook(() => useSessionTimeout(), {
      wrapper: createWrapper(),
    })

    const initial = result.current.timeRemaining

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.timeRemaining).toBeLessThan(initial)
  })

  it('extendSession triggers API call', async () => {
    const { apiClient } = await import('@/lib/api')
    const now = Date.now()
    mockSessionData.session.expiresAt = new Date(now + 200_000).toISOString()

    const { result } = renderHook(() => useSessionTimeout(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.extendSession()
    })

    expect(apiClient.post).toHaveBeenCalledWith('/auth/refresh')
  })
})
