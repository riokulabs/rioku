// SSE (Server-Sent Events) subscription hook with auto-reconnect.

import { useEffect, useRef, useState } from 'react'
import { authStore } from '@/lib/auth'

type SseStatus = 'connecting' | 'open' | 'closed'

interface UseSseOptions {
  enabled?: boolean
}

interface UseSseResult<T> {
  data: T | null
  error: Error | null
  status: SseStatus
}

const MAX_BACKOFF_MS = 30_000
const BASE_BACKOFF_MS = 1_000

/**
 * Subscribe to an SSE endpoint. Automatically reconnects on disconnect
 * with exponential backoff (capped at 30 s).
 *
 * Auth is passed via a `token` query parameter since the native EventSource
 * API does not support custom headers.
 */
export function useSse<T>(url: string, options?: UseSseOptions): UseSseResult<T> {
  const enabled = options?.enabled ?? true
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [status, setStatus] = useState<SseStatus>('closed')
  const retriesRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) {
      setStatus('closed')
      return
    }

    let es: EventSource | null = null
    let cancelled = false

    function connect() {
      if (cancelled) return

      // Append token as query param for auth
      const sseUrl = new URL(url, window.location.origin)
      const token = authStore.accessToken
      if (token) {
        sseUrl.searchParams.set('token', token)
      }

      setStatus('connecting')
      es = new EventSource(sseUrl.toString())

      es.onopen = () => {
        if (cancelled) return
        setStatus('open')
        setError(null)
        retriesRef.current = 0
      }

      es.onmessage = (event) => {
        if (cancelled) return
        try {
          setData(JSON.parse(event.data) as T)
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to parse SSE data'))
        }
      }

      es.onerror = () => {
        if (cancelled) return
        es?.close()
        setStatus('closed')

        // Exponential backoff
        const delay = Math.min(
          BASE_BACKOFF_MS * 2 ** retriesRef.current,
          MAX_BACKOFF_MS,
        )
        retriesRef.current++
        timerRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      es?.close()
      if (timerRef.current) clearTimeout(timerRef.current)
      setStatus('closed')
    }
  }, [url, enabled])

  return { data, error, status }
}
