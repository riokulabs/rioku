// Transport-agnostic event subscription hook.
// Wraps EventSource today; interface is stable for future WebSocket migration.

import { useEffect, useRef, useState } from 'react'

type EventStatus = 'connecting' | 'open' | 'closed'

interface UseEventSubscriptionOptions {
  enabled?: boolean
}

interface UseEventSubscriptionResult<T> {
  data: T | null
  status: EventStatus
  error: Error | null
}

const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

/**
 * Subscribe to a named event topic via SSE.
 *
 * Endpoint: GET /api/v1/events/{topic}
 * Auth: rioku_sid cookie (sent automatically for same-origin requests).
 *
 * Topics: 'config.changes', 'traffic.live', 'audit.events'
 */
export function useEventSubscription<T>(
  topic: string,
  options?: UseEventSubscriptionOptions,
): UseEventSubscriptionResult<T> {
  const enabled = options?.enabled ?? true
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [status, setStatus] = useState<EventStatus>('closed')
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
      setStatus('connecting')
      es = new EventSource(`/api/v1/events/${encodeURIComponent(topic)}`, {
        withCredentials: true,
      })

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
          setError(
            err instanceof Error ? err : new Error('Failed to parse event data'),
          )
        }
      }

      es.onerror = () => {
        if (cancelled) return
        es?.close()
        setStatus('closed')
        const baseDelay = Math.min(
          BASE_BACKOFF_MS * 2 ** retriesRef.current,
          MAX_BACKOFF_MS,
        )
        // Add 0-25% jitter to avoid thundering herd on reconnection
        const jitter = baseDelay * Math.random() * 0.25
        const delay = baseDelay + jitter
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
  }, [topic, enabled])

  return { data, error, status }
}
