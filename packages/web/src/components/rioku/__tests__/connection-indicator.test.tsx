import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ConnectionIndicator } from '../connection-indicator'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

import { toast } from 'sonner'

// Helper: flush pending promises + timers together
async function flushTimersAndMicrotasks(ms: number) {
  vi.advanceTimersByTime(ms)
  // Let promise callbacks settle
  await vi.waitFor(() => {})
}

describe('ConnectionIndicator', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as typeof fetch
    vi.mocked(toast.success).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is hidden when the health endpoint responds OK', async () => {
    fetchMock.mockResolvedValue({ ok: true })

    const { container } = render(<ConnectionIndicator />)

    await flushTimersAndMicrotasks(50)

    await waitFor(() => {
      expect(container.querySelector('[data-testid="connection-lost-banner"]')).not.toBeInTheDocument()
    })
  })

  it('shows banner when the health endpoint fails', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'))

    render(<ConnectionIndicator />)

    await flushTimersAndMicrotasks(50)

    await waitFor(() => {
      expect(screen.getByTestId('connection-lost-banner')).toBeInTheDocument()
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('shows banner when health endpoint returns non-OK status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })

    render(<ConnectionIndicator />)

    await flushTimersAndMicrotasks(50)

    await waitFor(() => {
      expect(screen.getByTestId('connection-lost-banner')).toBeInTheDocument()
    })
  })

  it('retries with exponential backoff', async () => {
    fetchMock.mockRejectedValue(new Error('down'))

    render(<ConnectionIndicator />)

    // Initial check
    await flushTimersAndMicrotasks(50)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // First retry after 1s
    await flushTimersAndMicrotasks(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Second retry after 2s (doubled from 1s)
    await flushTimersAndMicrotasks(2000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('shows toast on reconnection', async () => {
    let callCount = 0
    fetchMock.mockImplementation(() => {
      callCount++
      if (callCount <= 2) {
        return Promise.reject(new Error('down'))
      }
      return Promise.resolve({ ok: true })
    })

    render(<ConnectionIndicator />)

    // Initial check fails
    await flushTimersAndMicrotasks(50)
    await waitFor(() => {
      expect(screen.getByTestId('connection-lost-banner')).toBeInTheDocument()
    })

    // First retry fails (after 1s)
    await flushTimersAndMicrotasks(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Second retry succeeds (after 2s)
    await flushTimersAndMicrotasks(2000)

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Connection restored')
    })

    // Banner should be hidden
    await waitFor(() => {
      expect(screen.queryByTestId('connection-lost-banner')).not.toBeInTheDocument()
    })
  })

  it('pings the correct endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true })

    render(<ConnectionIndicator endpoint="/custom/health" />)

    await flushTimersAndMicrotasks(50)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/custom/health',
        expect.objectContaining({ method: 'GET', credentials: 'include' }),
      )
    })
  })

  it('passes className to the banner', async () => {
    fetchMock.mockRejectedValue(new Error('down'))

    render(<ConnectionIndicator className="my-class" />)

    await flushTimersAndMicrotasks(50)

    await waitFor(() => {
      expect(screen.getByTestId('connection-lost-banner')).toHaveClass('my-class')
    })
  })

  it('displays the correct banner text', async () => {
    fetchMock.mockRejectedValue(new Error('down'))

    render(<ConnectionIndicator />)

    await flushTimersAndMicrotasks(50)

    await waitFor(() => {
      const banner = screen.getByTestId('connection-lost-banner')
      expect(banner).toBeInTheDocument()
      // Check that the banner contains expected text content
      expect(banner.textContent).toContain('Connection lost')
      expect(banner.textContent).toContain('retrying')
    })
  })
})
