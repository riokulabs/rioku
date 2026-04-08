import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from '../use-mobile'

describe('useIsMobile', () => {
  let changeHandler: (() => void) | null = null

  beforeEach(() => {
    changeHandler = null
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'change') changeHandler = handler
        }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  it('returns false above mobile breakpoint (768px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
    })

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('returns true below mobile breakpoint', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      writable: true,
    })

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('updates when window width changes via matchMedia', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
    })

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    // Simulate resize below breakpoint
    Object.defineProperty(window, 'innerWidth', {
      value: 375,
      writable: true,
    })

    act(() => {
      changeHandler?.()
    })

    expect(result.current).toBe(true)
  })

  it('cleans up matchMedia listener on unmount', () => {
    const removeEventListener = vi.fn()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    const { unmount } = renderHook(() => useIsMobile())
    unmount()

    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
