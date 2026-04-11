import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock useCurrentUser so we don't need react-query.
vi.mock('@/hooks/use-auth', () => ({
  useCurrentUser: vi.fn(() => ({ id: 'test-user' })),
}))

// Mock @rioku/ui theme utilities to avoid pulling in the full ui package
// (which has internal import aliases not resolvable in vitest).
vi.mock('@rioku/ui', () => ({
  resolveTheme: (theme: string) => {
    if (theme === 'dark' || theme === 'light') return theme
    if (typeof window === 'undefined') return 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  },
  applyTheme: (resolved: string) => {
    const el = document.documentElement
    if (resolved === 'dark') {
      el.classList.add('dark')
    } else {
      el.classList.remove('dark')
    }
  },
}))

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    vi.resetModules()
  })

  it('uses default theme (dark)', async () => {
    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
    expect(result.current.resolvedTheme).toBe('dark')
  })

  it('applies dark class to documentElement on mount', async () => {
    const { useTheme } = await import('../use-theme')
    renderHook(() => useTheme())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggles from dark to light', async () => {
    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('light')
    })

    expect(result.current.theme).toBe('light')
    expect(result.current.resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('persists theme to scoped preferences', async () => {
    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('light')
    })

    // New scoped key format
    const stored = localStorage.getItem('rioku-pref:global:test-user:theme')
    expect(stored).toBe('"light"')
  })

  it('resolves system theme using matchMedia', async () => {
    // Mock matchMedia to return light
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)' ? false : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('system')
    })

    expect(result.current.theme).toBe('system')
    // With matches=false for dark, system resolves to light
    expect(result.current.resolvedTheme).toBe('light')
  })

  it('reads saved theme from scoped localStorage', async () => {
    localStorage.setItem(
      'rioku-pref:global:test-user:theme',
      JSON.stringify('light'),
    )

    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')
  })

  it('migrates legacy preferences on first access', async () => {
    localStorage.setItem(
      'rioku-preferences',
      JSON.stringify({ theme: 'light' }),
    )

    const { useTheme } = await import('../use-theme')
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')
  })
})
