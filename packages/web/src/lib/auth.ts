// In-memory token management. Tokens are NOT stored in localStorage for security.

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

interface AuthStore {
  accessToken: string | null
  refreshToken: string | null
  setTokens(tokens: TokenPair): void
  clearTokens(): void
  isAuthenticated(): boolean
}

function createAuthStore(): AuthStore {
  let accessToken: string | null = null
  let refreshToken: string | null = null

  return {
    get accessToken() {
      return accessToken
    },
    get refreshToken() {
      return refreshToken
    },
    setTokens(tokens: TokenPair) {
      accessToken = tokens.accessToken
      refreshToken = tokens.refreshToken
    },
    clearTokens() {
      accessToken = null
      refreshToken = null
    },
    isAuthenticated() {
      return accessToken !== null
    },
  }
}

export const authStore = createAuthStore()

export function getAuthHeader(): Record<string, string> {
  const token = authStore.accessToken
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

/** Exchange a bootstrap token or API key for an access/refresh token pair. */
export async function login(token: string): Promise<void> {
  const res = await fetch('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Login failed' }))
    throw new Error(body.detail ?? `Login failed (${res.status})`)
  }

  const data: TokenPair = await res.json()
  authStore.setTokens(data)
}

/** Refresh the access token using the stored refresh token. */
export async function refreshAccessToken(): Promise<boolean> {
  const rt = authStore.refreshToken
  if (!rt) return false

  const res = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  })

  if (!res.ok) {
    authStore.clearTokens()
    return false
  }

  const data: TokenPair = await res.json()
  authStore.setTokens(data)
  return true
}
