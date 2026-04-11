import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

let mockPathname = '/dashboard'

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: mockPathname } }),
}))

import { useFocusOnNavigate } from '../use-focus-on-navigate'

describe('useFocusOnNavigate', () => {
  let rafCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    mockPathname = '/dashboard'
    rafCallbacks = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('does not focus h1 on initial mount', () => {
    document.body.innerHTML = '<h1>Dashboard</h1>'
    const h1 = document.querySelector('h1')!
    const focusSpy = vi.spyOn(h1, 'focus')

    renderHook(() => useFocusOnNavigate())

    // Flush any pending rAF
    for (const cb of rafCallbacks) cb(0)

    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('focuses h1 after pathname change', () => {
    document.body.innerHTML = '<h1>Dashboard</h1>'

    const { rerender } = renderHook(() => useFocusOnNavigate())

    // Simulate navigation
    mockPathname = '/services'
    rerender()

    // Flush rAF
    const h1 = document.querySelector('h1')!
    const focusSpy = vi.spyOn(h1, 'focus')
    for (const cb of rafCallbacks) cb(0)

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: false })
  })

  it('sets tabindex=-1 on h1 before focusing', () => {
    document.body.innerHTML = '<h1>Dashboard</h1>'

    const { rerender } = renderHook(() => useFocusOnNavigate())

    mockPathname = '/routes'
    rerender()

    for (const cb of rafCallbacks) cb(0)

    const h1 = document.querySelector('h1')!
    expect(h1.getAttribute('tabindex')).toBe('-1')
  })

  it('does nothing when no h1 exists', () => {
    document.body.innerHTML = '<div>No heading</div>'

    const { rerender } = renderHook(() => useFocusOnNavigate())

    mockPathname = '/other'
    rerender()

    // Should not throw
    expect(() => {
      for (const cb of rafCallbacks) cb(0)
    }).not.toThrow()
  })
})
