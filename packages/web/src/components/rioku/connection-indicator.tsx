import { useEffect, useRef, useState, useCallback } from 'react'
import { WifiOffIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ConnectionIndicatorProps {
  /** Health endpoint to ping (default: /api/v1/health) */
  endpoint?: string
  /** Base interval in ms for health checks when connected (default: 15000) */
  interval?: number
  className?: string
}

const MIN_RETRY_MS = 1000
const MAX_RETRY_MS = 30000

function ConnectionIndicator({
  endpoint = '/api/v1/health',
  interval = 15000,
  className,
}: ConnectionIndicatorProps) {
  const [connected, setConnected] = useState(true)
  const retryDelayRef = useRef(MIN_RETRY_MS)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasDisconnectedRef = useRef(false)

  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (res.ok) {
        if (wasDisconnectedRef.current) {
          toast.success('Connection restored')
          wasDisconnectedRef.current = false
        }
        setConnected(true)
        retryDelayRef.current = MIN_RETRY_MS
        timerRef.current = setTimeout(checkHealth, interval)
      } else {
        throw new Error(`Health check returned ${res.status}`)
      }
    } catch {
      setConnected(false)
      wasDisconnectedRef.current = true
      // Exponential backoff
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, MAX_RETRY_MS)
      timerRef.current = setTimeout(checkHealth, delay)
    }
  }, [endpoint, interval])

  useEffect(() => {
    // Initial check
    timerRef.current = setTimeout(checkHealth, 0)
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
    }
  }, [checkHealth])

  if (connected) {
    return null
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="connection-lost-banner"
      className={cn(
        'flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400',
        className,
      )}
    >
      <WifiOffIcon className="size-4 shrink-0" />
      <span>Connection lost &mdash; retrying&hellip;</span>
    </div>
  )
}

export { ConnectionIndicator }
export type { ConnectionIndicatorProps }
