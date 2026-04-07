# Plan 4 of 5: Frontend Auth Overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the admin panel's auth layer to use cookie-based session auth, TanStack Router loaders for data fetching, and add user management, role management, profile, and session management pages.

**Spec:** `contrib-docs/design/auth-security-overhaul.md` — Parts 10, 12, and frontend portions of Parts 1, 3, 5, 6.

**Dependencies:** Plans 1 and 2 must be complete. The server must expose:
- `POST /api/v1/auth/login` — username/password + optional TOTP code, sets `rioku_sid` cookie
- `POST /api/v1/auth/logout` — clears session and cookie
- `GET /api/v1/auth/me` — returns session + user + permissions
- `PATCH /api/v1/auth/me` — update own display name and email
- `POST /api/v1/auth/password` — change own password
- `POST /api/v1/auth/totp/setup` — generate TOTP secret and QR URI
- `POST /api/v1/auth/totp/verify` — confirm TOTP setup
- `POST /api/v1/auth/totp/disable` — disable TOTP
- `GET /api/v1/auth/sessions` — list active sessions (`sessions:read`)
- `DELETE /api/v1/auth/sessions/{id}` — revoke session (`sessions:manage`)
- `GET /api/v1/users` — list users (`users:read`)
- `POST /api/v1/users` — create user (`users:create`)
- `PATCH /api/v1/users/{id}` — update user (`users:manage`)
- `POST /api/v1/users/{id}/suspend` — suspend user (`users:manage`)
- `POST /api/v1/users/{id}/activate` — activate user (`users:manage`)
- `POST /api/v1/users/{id}/unlock` — unlock user (`users:manage`)
- `POST /api/v1/users/{id}/reset-password` — force password reset (`users:manage`)
- `POST /api/v1/users/{id}/roles` — assign role (`roles:manage`)
- `DELETE /api/v1/users/{id}/roles/{role_id}` — remove role (`roles:manage`)
- `GET /api/v1/roles` — list roles (`roles:read`)
- `POST /api/v1/roles` — create custom role (`roles:manage`)
- `PATCH /api/v1/roles/{id}` — update custom role (`roles:manage`)
- `DELETE /api/v1/roles/{id}` — delete custom role (`roles:manage`)
- `GET /api/v1/permissions` — list all permissions (`roles:read`)

**Test commands:**
```bash
cd packages/web
npx tsc --noEmit
npx vite build
```

---

## File Map

```
packages/web/src/
  lib/
    auth.ts                    DELETE
    api.ts                     REWRITE
  hooks/
    use-auth.ts                REWRITE
    use-sse.ts                 KEEP (but consumers switch to use-events.ts)
    use-events.ts              NEW
  main.tsx                     UPDATE (router context)
  routes/
    __root.tsx                 REWRITE (beforeLoad auth guard)
    login.tsx                  REWRITE (username/password + TOTP)
    change-password.tsx        NEW
    security.tsx               UPDATE (add session management)
    settings/
      profile.tsx              NEW
      users.tsx                NEW
      roles.tsx                NEW
    index.tsx                  LOADER CONVERSION
    cluster.tsx                LOADER CONVERSION
    plugins.tsx                LOADER CONVERSION
    audit.tsx                  LOADER CONVERSION
    settings.tsx               LOADER CONVERSION
    config/
      routes.tsx               LOADER CONVERSION
      services.tsx             LOADER CONVERSION
      policies.tsx             LOADER CONVERSION
    traffic/
      live.tsx                 LOADER CONVERSION
      analytics.tsx            LOADER CONVERSION
      ai.tsx                   LOADER CONVERSION
  components/
    auth/
      protected-route.tsx      DELETE
    layout/
      app-sidebar.tsx          UPDATE (logout button + current user)
```

---

## Phase 1: Infrastructure (api.ts, hooks, main.tsx, root route)

### Task 1.1 — Delete `src/lib/auth.ts`

- [ ] Delete `packages/web/src/lib/auth.ts`

This file contains `authStore`, `getAuthHeader()`, `login()`, and `refreshAccessToken()`. All are replaced by cookie-based auth. No consumer should reference it after the following tasks are complete.

---

### Task 1.2 — Rewrite `src/lib/api.ts`

- [ ] Rewrite `packages/web/src/lib/api.ts`

Remove the `import { getAuthHeader }` line. Add `credentials: 'include'` to every fetch call. Drop the `Authorization` header injection. The `request()` function becomes:

```ts
const BASE = '/api/v1'

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    let error: ApiError
    try {
      error = await res.json()
    } catch {
      error = {
        type: 'about:blank',
        title: res.statusText,
        status: res.status,
        detail: `Request failed: ${method} ${path}`,
        instance: path,
      }
    }
    throw error
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
```

Add the new domain types needed by auth pages to the existing type block. Keep all existing types (`Route`, `Service`, `Policy`, `ConfigSnapshot`, `HealthStatus`, `ApiKey`, `AuditEntry`, `ApiError`) intact.

New types to add:

```ts
// --- Auth / Session types ---

export interface SessionInfo {
  id: string
  created_at: string
  last_active: string
  expires_at: string
  ip_address: string
  user_agent?: string
}

export interface UserInfo {
  id: string
  username: string
  display_name: string | null
  email: string | null
  roles: string[]
  permissions: string[]
  totp_enabled: boolean
  force_password_change: boolean
  status: 'active' | 'suspended' | 'locked'
  last_login: string | null
  created_at: string
}

export interface MeResponse {
  session: SessionInfo
  user: UserInfo
}

// --- RBAC types ---

export interface Permission {
  id: string
  resource: string
  action: string
  description: string
}

export interface Role {
  id: string
  name: string
  description: string
  is_builtin: boolean
  scopes: string[]
  created_at: string
  updated_at: string
}
```

Also add a `patch` method to `apiClient`:

```ts
export const apiClient = {
  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return request<T>('GET', path, undefined, params)
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('POST', path, body)
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PATCH', path, body)
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PUT', path, body)
  },
  del<T>(path: string): Promise<T> {
    return request<T>('DELETE', path)
  },
}
```

---

### Task 1.3 — Rewrite `src/hooks/use-auth.ts`

- [ ] Rewrite `packages/web/src/hooks/use-auth.ts`

Replace the token-based `AuthProvider` with a lightweight session hook. The hook fetches `GET /api/v1/auth/me` once on mount and returns the current session context. No token storage, no refresh logic.

```ts
// Session hook — reads from /auth/me (cookie auth).
// Used by root layout and sidebar to access current user info.

import { useQuery } from '@tanstack/react-query'
import type { MeResponse } from '@/lib/api'

export function useSession() {
  return useQuery<MeResponse>({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      fetch('/api/v1/auth/me', { credentials: 'include' }).then((r) => {
        if (!r.ok) throw new Error('Unauthenticated')
        return r.json() as Promise<MeResponse>
      }),
    staleTime: 60_000,
    retry: false,
  })
}

export function useCurrentUser() {
  const { data } = useSession()
  return data?.user ?? null
}

export function usePermissions() {
  const { data } = useSession()
  return data?.user.permissions ?? []
}

export function useHasPermission(permission: string): boolean {
  const permissions = usePermissions()
  return (
    permissions.includes('*') ||
    permissions.includes(permission) ||
    permissions.some(
      (p) => p.endsWith(':*') && permission.startsWith(p.slice(0, -1)),
    )
  )
}
```

Remove the old `AuthProvider`, `AuthContext`, `AuthContextValue`, and `useAuth` export. The `AuthProvider` wrapper in `main.tsx` will be removed in the next task — make sure nothing else imports `AuthProvider` or `useAuth` before proceeding.

---

### Task 1.4 — Create `src/hooks/use-events.ts`

- [ ] Create `packages/web/src/hooks/use-events.ts`

Transport-agnostic SSE hook. Uses `EventSource` with same-origin cookies — no auth header hack needed. The existing `use-sse.ts` can remain as a deprecated alias but new code should use `useEventSubscription`.

```ts
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
  }, [topic, enabled])

  return { data, error, status }
}
```

---

### Task 1.5 — Update `src/main.tsx`

- [ ] Update `packages/web/src/main.tsx`

Pass `queryClient` into the router context so loaders can call `context.queryClient.ensureQueryData()`. Remove `AuthProvider` (no longer needed — session is fetched via `useSession()` hook, not a React context provider).

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import '@/lib/i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const router = createRouter({
  routeTree,
  context: { queryClient },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  interface RouterContext {
    queryClient: QueryClient
  }
}

const root = document.getElementById('root')!
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
)
```

---

### Task 1.6 — Rewrite `src/routes/__root.tsx`

- [ ] Rewrite `packages/web/src/routes/__root.tsx`

Replace the `ProtectedRoute` wrapper with a `beforeLoad` auth guard on the root route. The guard fetches `/auth/me` before any child route renders. On 401, it redirects to `/login`. If `force_password_change` is true, it redirects to `/change-password`. The resolved session is passed down via route context.

Remove the `AuthProvider` import. Remove the `ProtectedRoute` import and wrapper. The login and change-password routes are excluded from the guard by checking `location.pathname`.

```tsx
import { useState, useCallback } from 'react'
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { SidebarProvider, SidebarInset, useSidebar } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Header } from '@/components/layout/header'
import { CommandPalette } from '@/components/layout/command-palette'
import { KeyboardShortcutHelp } from '@/components/layout/keyboard-shortcut-help'
import { useHotkey } from '@/hooks/use-hotkeys'
import { useTheme } from '@/hooks/use-theme'
import type { MeResponse } from '@/lib/api'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location }) => {
    const unguarded = ['/login', '/change-password']
    if (unguarded.includes(location.pathname)) return

    const res = await fetch('/api/v1/auth/me', { credentials: 'include' })
    if (!res.ok) {
      throw redirect({ to: '/login' })
    }
    const data: MeResponse = await res.json()
    if (
      data.user.force_password_change &&
      location.pathname !== '/change-password'
    ) {
      throw redirect({ to: '/change-password' })
    }
    return { session: data }
  },
  component: RootLayout,
})

function RootLayout() {
  const routerState = useRouterState()
  const isLoginRoute = routerState.location.pathname === '/login'
  const isChangePasswordRoute =
    routerState.location.pathname === '/change-password'

  if (isLoginRoute || isChangePasswordRoute) {
    return (
      <>
        <Outlet />
        <Toaster position="bottom-right" richColors />
      </>
    )
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppShell />
        <Toaster position="bottom-right" richColors />
      </SidebarProvider>
    </TooltipProvider>
  )
}

function AppShell() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const { toggleSidebar } = useSidebar()
  const { resolvedTheme, setTheme } = useTheme()

  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), [])
  const toggleShortcutHelp = useCallback(
    () => setShortcutHelpOpen((prev) => !prev),
    [],
  )
  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  useHotkey('Mod+b', toggleSidebar, { scope: 'global' })
  useHotkey('Mod+k', openCommandPalette, { scope: 'global' })
  useHotkey('?', toggleShortcutHelp, { scope: 'global' })
  useHotkey('Mod+Shift+t', toggleTheme, { scope: 'global' })

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <Header onOpenCommandPalette={openCommandPalette} />
        <div className="flex-1 overflow-auto p-4">
          <Outlet />
        </div>
      </SidebarInset>
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
      <KeyboardShortcutHelp
        open={shortcutHelpOpen}
        onOpenChange={setShortcutHelpOpen}
      />
    </>
  )
}
```

---

### Task 1.7 — Delete `src/components/auth/protected-route.tsx`

- [ ] Delete `packages/web/src/components/auth/protected-route.tsx`

The `ProtectedRoute` component is superseded by the `beforeLoad` auth guard on the root route. Verify no other file imports it before deleting.

---

## Phase 2: Auth Pages

### Task 2.1 — Rewrite `src/routes/login.tsx`

- [ ] Rewrite `packages/web/src/routes/login.tsx`

Replace the token-based form with a username/password form. Handle the `requires_totp` response by showing a TOTP code field. On success redirect to `/`. On `force_password_change` the root `beforeLoad` guard handles the redirect — login just needs to navigate to `/`.

```tsx
import { useState, type FormEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [requiresTotp, setRequiresTotp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const body: Record<string, string> = {
        username: username.trim(),
        password,
      }
      if (requiresTotp && totpCode.trim()) {
        body.totp_code = totpCode.trim()
      }

      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      if (res.status === 401) {
        const data = await res.json().catch(() => ({}))
        if (data.requires_totp) {
          setRequiresTotp(true)
          setError('Enter your authenticator code.')
          return
        }
        setError('Invalid username or password.')
        return
      }

      if (res.status === 423) {
        setError('Account is locked. Try again later.')
        return
      }

      if (res.status === 403) {
        setError('Account suspended. Contact an administrator.')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail ?? 'Login failed.')
        return
      }

      // Root beforeLoad will handle force_password_change redirect
      await navigate({ to: '/' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <RiokuLogo />
          <CardTitle className="mt-2 text-xl">Rioku</CardTitle>
          <CardDescription>
            {t('auth.login', 'Log in')} to your gateway
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus={!requiresTotp}
                autoComplete="username"
                disabled={requiresTotp}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={requiresTotp}
              />
            </div>
            {requiresTotp && (
              <div className="space-y-2">
                <Label htmlFor="totp">Authenticator code</Label>
                <Input
                  id="totp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  autoFocus
                  autoComplete="one-time-code"
                  placeholder="000000"
                />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? 'Signing in...'
                : requiresTotp
                  ? 'Verify'
                  : t('auth.login', 'Log in')}
            </Button>
            {requiresTotp && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setRequiresTotp(false)
                  setTotpCode('')
                  setError(null)
                }}
              >
                Back
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// Inline — identical to original login.tsx SVG, kept local to avoid a shared
// component import that triggers route tree regeneration.
function RiokuLogo() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="login-hex-gradient"
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <path
        d="M16 2 L28.124 9 L28.124 23 L16 30 L3.876 23 L3.876 9 Z"
        fill="url(#login-hex-gradient)"
        opacity="0.9"
      />
      <text
        x="16"
        y="20"
        textAnchor="middle"
        fill="white"
        fontSize="14"
        fontWeight="700"
        fontFamily="sans-serif"
      >
        R
      </text>
    </svg>
  )
}
```

---

### Task 2.2 — Create `src/routes/change-password.tsx`

- [ ] Create `packages/web/src/routes/change-password.tsx`

Forced password change page. Shown when `force_password_change` is true on the user record. After a successful change the server clears the flag; navigate to `/` and `beforeLoad` will proceed normally.

```tsx
import { useState, type FormEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/change-password')({
  component: ChangePasswordPage,
})

function ChangePasswordPage() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (next !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ current_password: current, new_password: next }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail ?? 'Password change failed.')
        return
      }

      await navigate({ to: '/' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Change your password</CardTitle>
          <CardDescription>
            You must set a new password before continuing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current">Current password</Label>
              <Input
                id="current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">New password</Label>
              <Input
                id="new"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Saving...' : 'Set new password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

---

## Phase 3: Settings Pages

### Task 3.1 — Create `src/routes/settings/profile.tsx`

- [ ] Create `packages/web/src/routes/settings/profile.tsx`

User profile page accessible to all authenticated users. Three sections:

1. **Profile** — display name and email, PATCH to `/auth/me`
2. **Password** — change own password, POST to `/auth/password`
3. **Two-factor authentication** — TOTP setup/disable

For TOTP setup, display the QR code using an `<img>` with a data URI generated from the `qr_uri` returned by `/auth/totp/setup`. Use the `qrcode` package if it is already a dependency; otherwise render the `qr_uri` as text with a note to scan with an authenticator app. Check `packages/web/package.json` before deciding.

The route gets `session` from the root route context via `Route.useRouteContext()`.

```tsx
import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageHeader } from '@/components/rioku/page-header'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiClient } from '@/lib/api'

export const Route = createFileRoute('/settings/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { session } = Route.useRouteContext()
  const user = session.user
  const queryClient = useQueryClient()

  // --- Profile form ---
  const [displayName, setDisplayName] = useState(user.display_name ?? '')
  const [email, setEmail] = useState(user.email ?? '')

  const profileMutation = useMutation({
    mutationFn: () =>
      apiClient.patch('/auth/me', { display_name: displayName, email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      toast.success('Profile updated')
    },
    onError: () => toast.error('Failed to update profile'),
  })

  // --- Password change form ---
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)

  const passwordMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/auth/password', {
        current_password: currentPw,
        new_password: newPw,
      }),
    onSuccess: () => {
      toast.success('Password changed')
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    },
    onError: (err: { detail?: string }) =>
      toast.error(err.detail ?? 'Failed to change password'),
  })

  const handlePasswordSubmit = (e: FormEvent) => {
    e.preventDefault()
    setPwError(null)
    if (newPw !== confirmPw) {
      setPwError('Passwords do not match.')
      return
    }
    passwordMutation.mutate()
  }

  // --- TOTP ---
  const [totpSetup, setTotpSetup] = useState<{
    secret: string
    qr_uri: string
  } | null>(null)
  const [totpVerifyCode, setTotpVerifyCode] = useState('')

  const totpSetupMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ secret: string; qr_uri: string }>('/auth/totp/setup'),
    onSuccess: (data) => setTotpSetup(data),
    onError: () => toast.error('Failed to start TOTP setup'),
  })

  const totpVerifyMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/auth/totp/verify', { code: totpVerifyCode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      toast.success('Two-factor authentication enabled')
      setTotpSetup(null)
      setTotpVerifyCode('')
    },
    onError: () => toast.error('Invalid code — try again'),
  })

  const totpDisableMutation = useMutation({
    mutationFn: () => apiClient.post('/auth/totp/disable'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      toast.success('Two-factor authentication disabled')
    },
    onError: () => toast.error('Failed to disable TOTP'),
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Manage your account settings" />

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Update your display name and email address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              profileMutation.mutate()
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={user.username} readOnly className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={profileMutation.isPending}>
              {profileMutation.isPending ? 'Saving...' : 'Save changes'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw-current">Current password</Label>
              <Input
                id="pw-current"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw-new">New password</Label>
              <Input
                id="pw-new"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw-confirm">Confirm new password</Label>
              <Input
                id="pw-confirm"
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {pwError && <p className="text-sm text-destructive">{pwError}</p>}
            <Button type="submit" disabled={passwordMutation.isPending}>
              {passwordMutation.isPending ? 'Saving...' : 'Change password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* TOTP */}
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Use an authenticator app (e.g. Google Authenticator, Authy) for a
            second layer of protection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user.totp_enabled ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Enabled</Badge>
                <span className="text-sm text-muted-foreground">
                  TOTP is active on this account.
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => totpDisableMutation.mutate()}
                disabled={totpDisableMutation.isPending}
              >
                Disable
              </Button>
            </div>
          ) : totpSetup ? (
            <div className="space-y-4">
              <p className="text-sm">
                Scan this URI with your authenticator app, then enter the
                6-digit code to confirm.
              </p>
              <code className="block break-all rounded bg-muted px-3 py-2 text-xs">
                {totpSetup.qr_uri}
              </code>
              <p className="text-xs text-muted-foreground">
                Manual secret: <span className="font-mono">{totpSetup.secret}</span>
              </p>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="totp-code">Verification code</Label>
                  <Input
                    id="totp-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={totpVerifyCode}
                    onChange={(e) => setTotpVerifyCode(e.target.value)}
                    placeholder="000000"
                  />
                </div>
                <Button
                  onClick={() => totpVerifyMutation.mutate()}
                  disabled={
                    totpVerifyMutation.isPending || totpVerifyCode.length !== 6
                  }
                >
                  {totpVerifyMutation.isPending ? 'Verifying...' : 'Enable'}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTotpSetup(null)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => totpSetupMutation.mutate()}
              disabled={totpSetupMutation.isPending}
            >
              {totpSetupMutation.isPending ? 'Setting up...' : 'Enable TOTP'}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

---

### Task 3.2 — Create `src/routes/settings/users.tsx`

- [ ] Create `packages/web/src/routes/settings/users.tsx`

User management page. Only visible to users with `users:read` permission — check on render and show an empty/permission-denied state if not met. The loader prefetches the user list.

Columns: username, display name, roles (badges), status badge, last login (TimeAgo), actions dropdown.

Actions: Edit (sheet with display name, email, roles), Suspend, Activate, Unlock, Reset password, Assign/remove roles.

Create user dialog: username, display name, email, initial password, role assignment.

```tsx
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PlusIcon,
  MoreHorizontalIcon,
  ShieldOffIcon,
  ShieldCheckIcon,
  UnlockIcon,
  KeyRoundIcon,
  PencilIcon,
  UsersIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { UserInfo, Role } from '@/lib/api'
import { useHasPermission } from '@/hooks/use-auth'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const Route = createFileRoute('/settings/users')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['users'],
      queryFn: () => apiClient.get<UserInfo[]>('/users'),
    }),
  component: UsersPage,
})

// Status badge colours match the UserInfo.status values
const STATUS_VARIANT: Record<
  UserInfo['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'default',
  suspended: 'destructive',
  locked: 'outline',
}

function UsersPage() {
  const canRead = useHasPermission('users:read')
  const canCreate = useHasPermission('users:create')
  const canManage = useHasPermission('users:manage')
  const queryClient = useQueryClient()

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<UserInfo[]>('/users'),
    initialData: Route.useLoaderData(),
  })

  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiClient.get<Role[]>('/roles'),
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserInfo | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<UserInfo | null>(null)

  // Create user form state
  const [createForm, setCreateForm] = useState({
    username: '',
    display_name: '',
    email: '',
    password: '',
  })

  const createMutation = useMutation({
    mutationFn: (payload: typeof createForm) =>
      apiClient.post('/users', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User created')
      setCreateOpen(false)
      setCreateForm({ username: '', display_name: '', email: '', password: '' })
    },
    onError: (err: { detail?: string }) =>
      toast.error(err.detail ?? 'Failed to create user'),
  })

  const suspendMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/users/${id}/suspend`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User suspended')
      setSuspendTarget(null)
    },
    onError: () => toast.error('Failed to suspend user'),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/users/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User activated')
    },
    onError: () => toast.error('Failed to activate user'),
  })

  const unlockMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/users/${id}/unlock`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Account unlocked')
    },
    onError: () => toast.error('Failed to unlock account'),
  })

  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/users/${id}/reset-password`),
    onSuccess: () => toast.success('Password reset — user will be prompted on next login'),
    onError: () => toast.error('Failed to reset password'),
  })

  if (!canRead) {
    return (
      <EmptyState
        icon={<UsersIcon className="size-5" />}
        title="Access denied"
        description="You do not have permission to view users."
      />
    )
  }

  const users = usersQuery.data ?? []
  const roles = rolesQuery.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage user accounts and role assignments"
      />

      <DataTable
        title="User accounts"
        columns={[
          {
            key: 'username',
            header: 'Username',
            sortable: true,
            render: (r) => (
              <span className="font-mono text-sm">{r.username as string}</span>
            ),
          },
          {
            key: 'display_name',
            header: 'Name',
            render: (r) => (
              <span className="text-sm">
                {(r.display_name as string) ?? '—'}
              </span>
            ),
          },
          {
            key: 'roles',
            header: 'Roles',
            render: (r) => (
              <div className="flex flex-wrap gap-1">
                {(r.roles as string[]).map((role) => (
                  <Badge key={role} variant="secondary">
                    {role}
                  </Badge>
                ))}
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <Badge variant={STATUS_VARIANT[r.status as UserInfo['status']]}>
                {r.status as string}
              </Badge>
            ),
          },
          {
            key: 'last_login',
            header: 'Last login',
            render: (r) =>
              r.last_login ? (
                <TimeAgo date={r.last_login as string} />
              ) : (
                <span className="text-sm text-muted-foreground">Never</span>
              ),
          },
          {
            key: '_actions',
            header: '',
            render: (r) => {
              const user = r as unknown as UserInfo
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" />}
                  >
                    <MoreHorizontalIcon className="size-4" />
                    <span className="sr-only">Actions</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canManage && (
                      <DropdownMenuItem
                        onClick={() => setEditTarget(user)}
                      >
                        <PencilIcon className="size-4" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {canManage && (
                      <DropdownMenuItem
                        onClick={() => resetPasswordMutation.mutate(user.id)}
                      >
                        <KeyRoundIcon className="size-4" />
                        Reset password
                      </DropdownMenuItem>
                    )}
                    {canManage && user.status === 'locked' && (
                      <DropdownMenuItem
                        onClick={() => unlockMutation.mutate(user.id)}
                      >
                        <UnlockIcon className="size-4" />
                        Unlock account
                      </DropdownMenuItem>
                    )}
                    {canManage && user.status === 'active' && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setSuspendTarget(user)}
                        >
                          <ShieldOffIcon className="size-4" />
                          Suspend
                        </DropdownMenuItem>
                      </>
                    )}
                    {canManage && user.status === 'suspended' && (
                      <DropdownMenuItem
                        onClick={() => activateMutation.mutate(user.id)}
                      >
                        <ShieldCheckIcon className="size-4" />
                        Activate
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            },
          },
        ]}
        data={users}
        searchable
        searchPlaceholder="Search users..."
        pageSize={20}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              Create user
            </Button>
          ) : undefined
        }
        emptyState={
          <EmptyState
            icon={<UsersIcon className="size-5" />}
            title="No users"
            description="No user accounts found."
          />
        }
      />

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Add a new user account. The user will be prompted to change their
              password on first login.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-username">Username</Label>
              <Input
                id="new-username"
                value={createForm.username}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    username: e.target.value,
                  }))
                }
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-display-name">Display name</Label>
              <Input
                id="new-display-name"
                value={createForm.display_name}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    display_name: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, email: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Initial password</Label>
              <Input
                id="new-password"
                type="password"
                value={createForm.password}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={
                createMutation.isPending ||
                !createForm.username ||
                !createForm.password
              }
            >
              {createMutation.isPending ? 'Creating...' : 'Create user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit user sheet */}
      <EditUserSheet
        user={editTarget}
        roles={roles}
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
      />

      {/* Suspend confirmation */}
      <ConfirmDialog
        open={suspendTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSuspendTarget(null)
        }}
        title="Suspend user"
        description={`Suspend ${suspendTarget?.username}? All active sessions will be revoked immediately.`}
        confirmLabel="Suspend"
        variant="destructive"
        loading={suspendMutation.isPending}
        onConfirm={() => {
          if (suspendTarget) suspendMutation.mutate(suspendTarget.id)
        }}
      />
    </div>
  )
}

interface EditUserSheetProps {
  user: UserInfo | null
  roles: Role[]
  open: boolean
  onClose: () => void
}

function EditUserSheet({ user, roles, open, onClose }: EditUserSheetProps) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/users/${user!.id}`, {
        display_name: displayName,
        email,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User updated')
      onClose()
    },
    onError: () => toast.error('Failed to update user'),
  })

  const assignRoleMutation = useMutation({
    mutationFn: (roleId: string) =>
      apiClient.post(`/users/${user!.id}/roles`, { role_id: roleId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: () => toast.error('Failed to assign role'),
  })

  const removeRoleMutation = useMutation({
    mutationFn: (roleId: string) =>
      apiClient.del(`/users/${user!.id}/roles/${roleId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: () => toast.error('Failed to remove role'),
  })

  if (!user) return null

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit user — {user.username}</SheetTitle>
          <SheetDescription>
            Update profile details and role assignments.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <Label htmlFor="edit-display-name">Display name</Label>
            <Input
              id="edit-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Roles</Label>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((role) => {
                const assigned = user.roles.includes(role.name)
                return (
                  <Button
                    key={role.id}
                    variant={assigned ? 'default' : 'outline'}
                    size="xs"
                    onClick={() =>
                      assigned
                        ? removeRoleMutation.mutate(role.id)
                        : assignRoleMutation.mutate(role.id)
                    }
                  >
                    {role.name}
                  </Button>
                )
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

---

### Task 3.3 — Create `src/routes/settings/roles.tsx`

- [ ] Create `packages/web/src/routes/settings/roles.tsx`

Role management page. Only visible to users with `roles:read` permission. Loader prefetches roles and permissions lists.

Columns: name, description, built-in badge, scope count, actions (edit, delete). Edit role sheet shows available permissions as toggleable buttons. Create custom role dialog with name, description, scope selection. Superadmin role is read-only — no edit or delete actions shown.

```tsx
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
  ShieldIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { Role, Permission } from '@/lib/api'
import { useHasPermission } from '@/hooks/use-auth'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const Route = createFileRoute('/settings/roles')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: ['roles'],
        queryFn: () => apiClient.get<Role[]>('/roles'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['permissions'],
        queryFn: () => apiClient.get<Permission[]>('/permissions'),
      }),
    ]),
  component: RolesPage,
})

function RolesPage() {
  const canRead = useHasPermission('roles:read')
  const canManage = useHasPermission('roles:manage')
  const queryClient = useQueryClient()

  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiClient.get<Role[]>('/roles'),
  })

  const permissionsQuery = useQuery({
    queryKey: ['permissions'],
    queryFn: () => apiClient.get<Permission[]>('/permissions'),
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Role | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    scopes: [] as string[],
  })

  const createMutation = useMutation({
    mutationFn: () => apiClient.post('/roles', createForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Role created')
      setCreateOpen(false)
      setCreateForm({ name: '', description: '', scopes: [] })
    },
    onError: (err: { detail?: string }) =>
      toast.error(err.detail ?? 'Failed to create role'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Role deleted')
      setDeleteTarget(null)
    },
    onError: () => toast.error('Failed to delete role'),
  })

  if (!canRead) {
    return (
      <EmptyState
        icon={<ShieldIcon className="size-5" />}
        title="Access denied"
        description="You do not have permission to view roles."
      />
    )
  }

  const roles = rolesQuery.data ?? []
  const permissions = permissionsQuery.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles"
        description="Manage roles and permission scopes"
      />

      <DataTable
        title="Roles"
        columns={[
          {
            key: 'name',
            header: 'Name',
            sortable: true,
            render: (r) => (
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{r.name as string}</span>
                {r.is_builtin && (
                  <Badge variant="secondary" className="text-xs">
                    built-in
                  </Badge>
                )}
              </div>
            ),
          },
          {
            key: 'description',
            header: 'Description',
            render: (r) => (
              <span className="text-sm text-muted-foreground">
                {r.description as string}
              </span>
            ),
          },
          {
            key: 'scopes',
            header: 'Scopes',
            render: (r) => (
              <span className="text-sm">
                {(r.scopes as string[]).length} scope
                {(r.scopes as string[]).length !== 1 ? 's' : ''}
              </span>
            ),
          },
          {
            key: '_actions',
            header: '',
            render: (r) => {
              const role = r as unknown as Role
              const isProtected = role.name === 'superadmin'
              if (!canManage || isProtected) return null
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" />}
                  >
                    <MoreHorizontalIcon className="size-4" />
                    <span className="sr-only">Actions</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditTarget(role)}>
                      <PencilIcon className="size-4" />
                      Edit scopes
                    </DropdownMenuItem>
                    {!role.is_builtin && (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteTarget(role)}
                      >
                        <TrashIcon className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            },
          },
        ]}
        data={roles}
        pageSize={20}
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              Create role
            </Button>
          ) : undefined
        }
        emptyState={
          <EmptyState
            icon={<ShieldIcon className="size-5" />}
            title="No roles"
            description="No roles found."
          />
        }
      />

      {/* Create role dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>
              Define a custom role with a specific set of permission scopes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="my-custom-role"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">Description</Label>
              <Input
                id="role-desc"
                value={createForm.description}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {permissions.map((p) => (
                  <Button
                    key={p.id}
                    variant={
                      createForm.scopes.includes(p.id) ? 'default' : 'outline'
                    }
                    size="xs"
                    onClick={() =>
                      setCreateForm((prev) => ({
                        ...prev,
                        scopes: prev.scopes.includes(p.id)
                          ? prev.scopes.filter((s) => s !== p.id)
                          : [...prev.scopes, p.id],
                      }))
                    }
                  >
                    {p.id}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                createMutation.isPending ||
                !createForm.name ||
                createForm.scopes.length === 0
              }
            >
              {createMutation.isPending ? 'Creating...' : 'Create role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit role sheet */}
      {editTarget && (
        <EditRoleSheet
          role={editTarget}
          permissions={permissions}
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete role"
        description={`Delete "${deleteTarget?.name}"? Users with this role will lose associated permissions.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
      />
    </div>
  )
}

interface EditRoleSheetProps {
  role: Role
  permissions: Permission[]
  open: boolean
  onClose: () => void
}

function EditRoleSheet({
  role,
  permissions,
  open,
  onClose,
}: EditRoleSheetProps) {
  const queryClient = useQueryClient()
  const [scopes, setScopes] = useState<string[]>(role.scopes)

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/roles/${role.id}`, { scopes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Role updated')
      onClose()
    },
    onError: () => toast.error('Failed to update role'),
  })

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit role — {role.name}</SheetTitle>
          <SheetDescription>
            Toggle permission scopes for this role.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap gap-1.5">
            {permissions.map((p) => (
              <Button
                key={p.id}
                variant={scopes.includes(p.id) ? 'default' : 'outline'}
                size="xs"
                onClick={() =>
                  setScopes((prev) =>
                    prev.includes(p.id)
                      ? prev.filter((s) => s !== p.id)
                      : [...prev, p.id],
                  )
                }
              >
                {p.id}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

---

## Phase 4: Security Page — Session Management

### Task 4.1 — Update `src/routes/security.tsx`

- [ ] Update `packages/web/src/routes/security.tsx`

Add a session management section above the existing API Keys section. Requires `sessions:read` permission to display; the revoke action requires `sessions:manage`.

Convert the existing `keysQuery` and `healthQuery` to use loader data. Add a sessions loader. The current session (from the root context) is highlighted.

**Loader addition at the top of the file:**
```tsx
export const Route = createFileRoute('/security')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: ['keys'],
        queryFn: () => apiClient.get<ApiKey[]>('/keys'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['health'],
        queryFn: () => apiClient.get<HealthStatus>('/health'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['sessions'],
        queryFn: () => apiClient.get<SessionInfo[]>('/auth/sessions'),
      }),
    ]),
  component: Security,
})
```

**Session management section to add (insert before the API Keys section):**
```tsx
{/* Session Management Section */}
{canReadSessions && (
  <section className="space-y-4">
    {sessionsLoading ? (
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    ) : (
      <DataTable
        title="Active sessions"
        columns={[
          {
            key: 'id',
            header: 'Session',
            render: (r) => (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">
                  {(r.id as string).slice(0, 8)}…
                </span>
                {r.id === currentSessionId && (
                  <Badge variant="secondary">current</Badge>
                )}
              </div>
            ),
          },
          {
            key: 'ip_address',
            header: 'IP address',
            render: (r) => (
              <span className="font-mono text-sm">
                {(r.ip_address as string) ?? '—'}
              </span>
            ),
          },
          {
            key: 'last_active',
            header: 'Last active',
            render: (r) => <TimeAgo date={r.last_active as string} />,
          },
          {
            key: 'expires_at',
            header: 'Expires',
            render: (r) => <TimeAgo date={r.expires_at as string} />,
          },
          {
            key: '_actions',
            header: '',
            render: (r) => {
              const isCurrent = r.id === currentSessionId
              if (!canManageSessions || isCurrent) return null
              return (
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() =>
                    revokeSessionMutation.mutate(r.id as string)
                  }
                  disabled={revokeSessionMutation.isPending}
                >
                  Revoke
                </Button>
              )
            },
          },
        ]}
        data={sessions}
        pageSize={10}
        emptyState={
          <EmptyState
            icon={<ShieldCheckIcon className="size-5" />}
            title="No active sessions"
            description="No other sessions are currently active."
          />
        }
      />
    )}
  </section>
)}
```

Add these variables/hooks to the `Security()` function body, drawing from the root route context and the session query:

```tsx
const { session: rootSession } = Route.useRouteContext()
const currentSessionId = rootSession.session.id
const canReadSessions = useHasPermission('sessions:read')
const canManageSessions = useHasPermission('sessions:manage')

const sessionsQuery = useQuery({
  queryKey: ['sessions'],
  queryFn: () => apiClient.get<SessionInfo[]>('/auth/sessions'),
})
const sessions = sessionsQuery.data ?? []
const sessionsLoading = sessionsQuery.isLoading

const revokeSessionMutation = useMutation({
  mutationFn: (id: string) => apiClient.del(`/auth/sessions/${id}`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
    toast.success('Session revoked')
  },
  onError: () => toast.error('Failed to revoke session'),
})
```

Add the necessary imports: `useHasPermission` from `@/hooks/use-auth`, `SessionInfo` from `@/lib/api`.

---

## Phase 5: Sidebar Updates

### Task 5.1 — Update `src/components/layout/app-sidebar.tsx`

- [ ] Update `packages/web/src/components/layout/app-sidebar.tsx`

Add three things to the sidebar:

1. Add `Users` and `Roles` to the nav under the `Security` section (conditionally rendered based on permissions).
2. Add a user display + logout button to `SidebarFooter`, above the Settings link.

The sidebar reads the current user from `useCurrentUser()`. The logout function POSTs to `/auth/logout` with `credentials: 'include'`, then navigates to `/login`.

**Logout handler:**
```tsx
const navigate = useNavigate()

async function handleLogout() {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
  })
  await navigate({ to: '/login' })
}
```

**User display in SidebarFooter (add above the Settings SidebarMenuItem):**
```tsx
{currentUser && state === 'expanded' && (
  <SidebarMenuItem>
    <div className="flex items-center justify-between px-2 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UserIcon className="size-3.5" />
        </div>
        <span className="truncate text-sm font-medium">
          {currentUser.display_name ?? currentUser.username}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleLogout}
        title="Log out"
      >
        <LogOutIcon className="size-3.5" />
        <span className="sr-only">Log out</span>
      </Button>
    </div>
  </SidebarMenuItem>
)}
```

**Navigation additions to the Security nav section:**
```tsx
{
  titleKey: 'nav.security',
  items: [
    { label: 'nav.security', path: '/security', icon: Lock },
    { label: 'nav.users', path: '/settings/users', icon: UsersIcon },
    { label: 'nav.roles', path: '/settings/roles', icon: ShieldIcon },
  ],
},
```

Wrap the Users and Roles nav items so they only render if the current user has the corresponding permission:

```tsx
{item.path === '/settings/users' && !canUsers ? null : (
  <SidebarMenuItem key={item.path}>
    ...
  </SidebarMenuItem>
)}
```

Use the `useHasPermission` hook inside `AppSidebar`. Add `UserIcon`, `LogOutIcon`, `UsersIcon`, `ShieldIcon` to the Lucide imports.

---

## Phase 6: Loader Conversions

Convert every existing route file to use a `loader` + `Route.useLoaderData()` pattern. The general rule: if a route has one or more `useQuery` calls at the top of its component function, extract them into a loader. Keep `useMutation` and reactive polling queries in the component.

For routes with multiple queries, use `Promise.all` in the loader and destructure the tuple in the component.

### Task 6.1 — Convert `src/routes/index.tsx`

- [ ] Convert `packages/web/src/routes/index.tsx`

The dashboard has three queries: `health`, `config`, and `audit`. Run all three in parallel via `Promise.all`.

```tsx
export const Route = createFileRoute('/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: ['health'],
        queryFn: () =>
          apiClient.get<HealthStatus>('/health'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['config'],
        queryFn: () =>
          apiClient.get<ConfigSnapshot>('/config'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['audit', 'recent'],
        queryFn: () =>
          apiClient.get<AuditEntry[]>('/audit?limit=5'),
      }),
    ]),
  component: Dashboard,
})

function Dashboard() {
  const [health, config, audit] = Route.useLoaderData()
  // ...
}
```

Remove the three `useQuery` declarations from `Dashboard()`. Replace `healthQuery.data`, `configQuery.data`, `auditQuery.data` references with the destructured loader variables. Remove `isLoading`/`isError` skeleton branches — data is available synchronously. Keep `healthQuery.isError` error states where the data may be legitimately absent, but remove loading skeletons.

---

### Task 6.2 — Convert `src/routes/config/routes.tsx`

- [ ] Convert `packages/web/src/routes/config/routes.tsx`

Single query: `config`. Extract to loader.

```tsx
export const Route = createFileRoute('/config/routes')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: ConfigRoutes,
})

function ConfigRoutes() {
  const config = Route.useLoaderData()
  const routes = config.routes
  const services = config.services
  // ...
}
```

Remove `configQuery` and `configQuery.isLoading` loading skeleton branch.

---

### Task 6.3 — Convert `src/routes/config/services.tsx`

- [ ] Convert `packages/web/src/routes/config/services.tsx`

Same pattern as routes — single `config` query extracted to loader.

---

### Task 6.4 — Convert `src/routes/config/policies.tsx`

- [ ] Convert `packages/web/src/routes/config/policies.tsx`

Same pattern as routes — single `config` query extracted to loader.

---

### Task 6.5 — Convert `src/routes/cluster.tsx`

- [ ] Convert `packages/web/src/routes/cluster.tsx`

Extract the cluster/nodes query to loader.

---

### Task 6.6 — Convert `src/routes/plugins.tsx`

- [ ] Convert `packages/web/src/routes/plugins.tsx`

Extract the plugins query to loader.

---

### Task 6.7 — Convert `src/routes/audit.tsx`

- [ ] Convert `packages/web/src/routes/audit.tsx`

Extract the audit log query to loader.

---

### Task 6.8 — Convert `src/routes/settings.tsx`

- [ ] Convert `packages/web/src/routes/settings.tsx`

Extract the settings query to loader.

---

### Task 6.9 — Convert `src/routes/traffic/live.tsx`

- [ ] Convert `packages/web/src/routes/traffic/live.tsx`

The live traffic route uses SSE for real-time events. SSE subscriptions stay in the component via `useEventSubscription` (the new hook from Task 1.4). Any one-time data queries (e.g. initial route list for filtering) go in the loader.

---

### Task 6.10 — Convert `src/routes/traffic/analytics.tsx`

- [ ] Convert `packages/web/src/routes/traffic/analytics.tsx`

Extract the analytics data query to loader.

---

### Task 6.11 — Convert `src/routes/traffic/ai.tsx`

- [ ] Convert `packages/web/src/routes/traffic/ai.tsx`

Extract the AI traffic query to loader.

---

## Verification

### TypeScript check

```bash
cd packages/web
npx tsc --noEmit
```

Zero errors expected. Common issues to watch for:
- Route context type: `Route.useRouteContext()` returns the context shape from `beforeLoad`. Ensure `__root.tsx` declares the return type correctly so child routes can access `session`.
- Loader data types: `Route.useLoaderData()` infers from the loader return type. If using `Promise.all`, destructure the tuple with correct types.
- Deleted imports: ensure no file still imports from `@/lib/auth` or `@/components/auth/protected-route`.

### Build check

```bash
cd packages/web
npx vite build
```

Bundle must complete without errors. Check that the route tree is valid (TanStack Router's file-based routing regenerates `routeTree.gen.ts` on build).

### Manual smoke test (sandbox required)

```bash
make sandbox
```

1. Browse to `http://localhost:7778`
2. Should redirect to `/login`
3. Log in as `root` with the seed credentials — verify redirect to `/change-password`
4. Set a new password — verify redirect to `/`
5. Verify sidebar shows current username and logout button
6. Click logout — verify redirect to `/login`
7. Log in again — verify dashboard loads without loading skeletons
8. Navigate to Settings > Users — verify user list appears
9. Navigate to Settings > Roles — verify role list appears
10. Navigate to Security — verify session list appears with current session highlighted
11. Navigate to Settings > Profile — verify profile form pre-populated; test TOTP setup flow
12. Verify permission-based hiding: log in as a `viewer` user and confirm Users/Roles nav items are hidden

---

## Commit Sequence

One commit per phase, conventional commits format, no AI references.

```
feat(web): rewrite api.ts for cookie auth, add auth domain types
feat(web): replace AuthProvider with lightweight session hook, add useEventSubscription
feat(web): pass queryClient into router context, add beforeLoad auth guard
feat(web): rewrite login page for username/password + TOTP, add change-password route
feat(web): add profile, users, and roles settings pages
feat(web): add session management to security page, add logout to sidebar
feat(web): convert all route files to use TanStack Router loaders
chore(web): delete auth.ts and protected-route.tsx
```
