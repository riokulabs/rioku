import { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/hooks/use-auth'
import { apiClient } from '@/lib/api'

const WARNING_THRESHOLD_SECONDS = 300 // 5 minutes

export interface SessionTimeoutState {
  timeRemaining: number
  showWarning: boolean
  isExpired: boolean
  extendSession: () => void
  isExtending: boolean
}

export function useSessionTimeout(): SessionTimeoutState {
  const { data } = useSession()
  const queryClient = useQueryClient()
  const [timeRemaining, setTimeRemaining] = useState<number>(Infinity)
  const [isExtending, setIsExtending] = useState(false)

  useEffect(() => {
    if (!data?.session.expiresAt) {
      setTimeRemaining(Infinity)
      return
    }

    function computeRemaining() {
      const expiresMs = new Date(data!.session.expiresAt).getTime()
      const nowMs = Date.now()
      return Math.max(0, Math.floor((expiresMs - nowMs) / 1000))
    }

    setTimeRemaining(computeRemaining())

    const interval = setInterval(() => {
      setTimeRemaining(computeRemaining())
    }, 1000)

    return () => clearInterval(interval)
  }, [data?.session.expiresAt])

  const extendSession = useCallback(async () => {
    setIsExtending(true)
    try {
      await apiClient.post('/auth/refresh')
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    } catch {
      // refresh failed, session will expire
    } finally {
      setIsExtending(false)
    }
  }, [queryClient])

  const showWarning = timeRemaining <= WARNING_THRESHOLD_SECONDS && timeRemaining > 0
  const isExpired = timeRemaining <= 0

  return { timeRemaining, showWarning, isExpired, extendSession, isExtending }
}
