import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEventSubscription } from '../use-events'

class MockEventSource {
  url: string
  withCredentials: boolean
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  readyState = 0
  close = vi.fn()

  constructor(url: string, init?: EventSourceInit) {
    this.url = url
    this.withCredentials = init?.withCredentials ?? false
    MockEventSource.instances.push(this)
  }

  // Helper for tests
  simulateOpen() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  simulateError() {
    this.onerror?.(new Event('error'))
  }

  static instances: MockEventSource[] = []
  static reset() {
    MockEventSource.instances = []
  }
}

describe('useEventSubscription', () => {
  beforeEach(() => {
    MockEventSource.reset()
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'EventSource', {
      value: MockEventSource,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates EventSource with correct URL and withCredentials', () => {
    renderHook(() => useEventSubscription('config.changes'))

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toContain(
      '/api/v1/events/config.changes',
    )
    expect(MockEventSource.instances[0].withCredentials).toBe(true)
  })

  it('sets status to open when connection opens', async () => {
    const { result } = renderHook(() =>
      useEventSubscription('config.changes'),
    )

    expect(result.current.status).toBe('connecting')

    act(() => {
      MockEventSource.instances[0].simulateOpen()
    })

    expect(result.current.status).toBe('open')
  })

  it('parses incoming message data and updates state', () => {
    const { result } = renderHook(() =>
      useEventSubscription<{ version: number }>('config.changes'),
    )

    act(() => {
      MockEventSource.instances[0].simulateOpen()
    })

    act(() => {
      MockEventSource.instances[0].simulateMessage(
        JSON.stringify({ version: 42 }),
      )
    })

    expect(result.current.data).toEqual({ version: 42 })
    expect(result.current.error).toBeNull()
  })

  it('sets error state on invalid JSON message', () => {
    const { result } = renderHook(() =>
      useEventSubscription<{ version: number }>('config.changes'),
    )

    act(() => {
      MockEventSource.instances[0].simulateOpen()
    })

    act(() => {
      MockEventSource.instances[0].simulateMessage('not-json{{{')
    })

    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('reconnects with exponential backoff on error', () => {
    renderHook(() => useEventSubscription('config.changes'))

    expect(MockEventSource.instances).toHaveLength(1)

    // Simulate error
    act(() => {
      MockEventSource.instances[0].simulateError()
    })

    // First backoff: 1000ms + up to 250ms jitter
    act(() => {
      vi.advanceTimersByTime(1250)
    })

    expect(MockEventSource.instances).toHaveLength(2)

    // Simulate another error
    act(() => {
      MockEventSource.instances[1].simulateError()
    })

    // Second backoff: 2000ms + up to 500ms jitter
    act(() => {
      vi.advanceTimersByTime(2500)
    })

    expect(MockEventSource.instances).toHaveLength(3)
  })

  it('does not connect when enabled is false', () => {
    const { result } = renderHook(() =>
      useEventSubscription('config.changes', { enabled: false }),
    )

    expect(MockEventSource.instances).toHaveLength(0)
    expect(result.current.status).toBe('closed')
  })

  it('closes EventSource on unmount', () => {
    const { unmount } = renderHook(() =>
      useEventSubscription('config.changes'),
    )

    const instance = MockEventSource.instances[0]
    unmount()

    expect(instance.close).toHaveBeenCalled()
  })

  it('clears reconnect timer on unmount', () => {
    const { unmount } = renderHook(() =>
      useEventSubscription('config.changes'),
    )

    // Trigger error to start reconnect timer
    act(() => {
      MockEventSource.instances[0].simulateError()
    })

    unmount()

    // Advance past backoff -- should NOT create new EventSource
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    // Only the original instance should exist
    expect(MockEventSource.instances).toHaveLength(1)
  })
})
