import { useState, useCallback } from 'react'
import { useSearch, useNavigate } from '@tanstack/react-router'

export const TIME_RANGE_OPTIONS = ['1h', '6h', '24h', '7d', '30d'] as const
export type TimeRange = (typeof TIME_RANGE_OPTIONS)[number]

function isValidRange(v: unknown): v is TimeRange {
  return TIME_RANGE_OPTIONS.includes(v as TimeRange)
}

/**
 * Shared time range state persisted in URL search params (?range=24h).
 * Falls back to '24h' when no search param or invalid value.
 */
export function useTimeRange() {
  // Try to read from URL search params for pages that use TanStack Router
  let urlRange: string | undefined
  let hasRouter = false
  try {
    const search = useSearch({ strict: false }) as Record<string, unknown>
    urlRange = search?.range as string | undefined
    hasRouter = true
  } catch {
    // Not inside a router context — fall back to local state
  }

  let navigate: ReturnType<typeof useNavigate> | null = null
  try {
    navigate = useNavigate()
  } catch {
    // Not inside a router context
  }

  const initial = isValidRange(urlRange) ? urlRange : '24h'
  const [localRange, setLocalRange] = useState<TimeRange>(initial)

  const range = isValidRange(urlRange) ? urlRange : localRange

  const setRange = useCallback(
    (newRange: TimeRange) => {
      if (!isValidRange(newRange)) return
      setLocalRange(newRange)
      if (hasRouter && navigate) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic cross-route search param
          ;(navigate as any)({
            search: (prev: Record<string, unknown>) => ({ ...prev, range: newRange }),
            replace: true,
          })
        } catch {
          // Navigation failed — local state is still updated
        }
      }
    },
    [hasRouter, navigate],
  )

  return { range, setRange }
}
