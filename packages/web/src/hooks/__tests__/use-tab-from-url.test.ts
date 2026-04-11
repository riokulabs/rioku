import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTabFromUrl } from '../use-tab-from-url'

// Mock window.location.search and history.replaceState
const replaceStateSpy = vi.fn()

beforeEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, search: '' },
  })
  window.history.replaceState = replaceStateSpy
})

describe('useTabFromUrl', () => {
  it('returns default tab when no search param', () => {
    const { result } = renderHook(() =>
      useTabFromUrl('overview', ['overview', 'matching', 'tls', 'policies']),
    )
    expect(result.current.activeTab).toBe('overview')
  })

  it('reads tab from URL search param', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, search: '?tab=tls' },
    })
    const { result } = renderHook(() =>
      useTabFromUrl('overview', ['overview', 'matching', 'tls', 'policies']),
    )
    expect(result.current.activeTab).toBe('tls')
  })

  it('falls back to default if URL param is invalid', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, search: '?tab=nonexistent' },
    })
    const { result } = renderHook(() =>
      useTabFromUrl('overview', ['overview', 'matching', 'tls']),
    )
    expect(result.current.activeTab).toBe('overview')
  })

  it('updates URL when tab changes', () => {
    const { result } = renderHook(() =>
      useTabFromUrl('overview', ['overview', 'matching', 'tls']),
    )
    act(() => {
      result.current.setActiveTab('matching')
    })
    expect(replaceStateSpy).toHaveBeenCalled()
    expect(result.current.activeTab).toBe('matching')
  })
})
