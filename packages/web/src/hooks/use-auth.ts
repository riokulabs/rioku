// Auth context and hook for React components.

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  createElement,
} from 'react'
import {
  authStore,
  login as authLogin,
  refreshAccessToken,
} from '@/lib/auth'

interface AuthContextValue {
  isAuthenticated: boolean | undefined
  login: (token: string) => Promise<void>
  logout: () => void
  user: null // Placeholder for future user info
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // Start as undefined while we check for existing tokens/refresh
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | undefined>(
    authStore.isAuthenticated() ? true : undefined,
  )

  // On mount, try refreshing if we have a refresh token
  useEffect(() => {
    if (authStore.isAuthenticated()) {
      setIsAuthenticated(true)
      return
    }
    if (authStore.refreshToken) {
      refreshAccessToken()
        .then((ok) => setIsAuthenticated(ok))
        .catch(() => setIsAuthenticated(false))
    } else {
      setIsAuthenticated(false)
    }
  }, [])

  // Listen for 401 responses globally to trigger logout
  useEffect(() => {
    const handler = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.status === 401) {
        authStore.clearTokens()
        setIsAuthenticated(false)
      }
    }
    window.addEventListener('rioku:unauthorized', handler)
    return () => window.removeEventListener('rioku:unauthorized', handler)
  }, [])

  const login = useCallback(async (token: string) => {
    await authLogin(token)
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(() => {
    authStore.clearTokens()
    setIsAuthenticated(false)
  }, [])

  const value: AuthContextValue = {
    isAuthenticated,
    login,
    logout,
    user: null,
  }

  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
