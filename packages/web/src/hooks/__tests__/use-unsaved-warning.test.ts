import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnsavedWarning } from '../use-unsaved-warning'

describe('useUnsavedWarning', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds beforeunload listener when dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedWarning(true))
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })

  it('does not add listener when not dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedWarning(false))
    const beforeunloadCalls = addSpy.mock.calls.filter(
      ([event]) => event === 'beforeunload',
    )
    expect(beforeunloadCalls).toHaveLength(0)
  })

  it('removes listener on cleanup', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useUnsavedWarning(true))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })
})
