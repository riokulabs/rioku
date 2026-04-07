# Design: Auth Security Overhaul — Sessions, Cookies, Security Headers, Route Loaders

## Context

The admin panel currently uses in-memory JWT Bearer tokens managed by client-side JavaScript. Every API call includes an `Authorization: Bearer <token>` header constructed in JS. There is no server-side session store, no HttpOnly cookies, no security headers, no server-side session revocation, no logout button, and no fingerprinting. Data fetching happens client-side via `useQuery` in components, causing loading skeleton waterfalls.

This design replaces the entire auth flow with server-side session management, HttpOnly cookie auth, security headers, and TanStack Router route loaders for data fetching.

## Goals

- Tokens invisible to JavaScript (HttpOnly cookies)
- Server can revoke any session instantly (admin suspend, logout)
- Session fingerprinting prevents cookie replay from different devices
- Full security header suite (CSP, X-Frame-Options, etc.)
- Data fetching via route loaders (no loading waterfalls on navigation)
- SSE auth via cookie (no URL param hack)
- Backwards compatible with CLI/API key Bearer auth
- Cluster-aware session caching with instant revocation broadcast

---

## Part 1: Session Store

### Sessions Table

```sql
CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    subject       TEXT NOT NULL,
    roles         TEXT NOT NULL,
    fingerprint   TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL,
    expires_at    TIMESTAMP NOT NULL,
    last_active   TIMESTAMP NOT NULL,
    ip_address    TEXT,
    user_agent    TEXT
);

CREATE INDEX idx_sessions_subject ON sessions(subject);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

- `id`: Cryptographically random session ID (32 bytes, base64url)
- `subject`: User identifier (e.g., "admin", "apikey:<id>")
- `roles`: JSON array of role strings (e.g., `["admin","read","write"]`)
- `fingerprint`: SHA-256 hash of `User-Agent + Accept-Language`
- `expires_at`: Absolute maximum session lifetime (7 days from creation)
- `last_active`: Sliding expiry tracker (session dies after 24h of inactivity)
- `ip_address`: Stored for audit visibility, NOT used for fingerprinting
- `user_agent`: Stored for admin visibility in session list

### Session Lifecycle

| Event | Action |
|---|---|
| Login | Create session row, set cookie |
| Every request | Validate session (cache → DB fallback), update `last_active` |
| Logout | Hard delete session row, clear cookie |
| Admin revokes session | Hard delete row, broadcast revocation to cluster |
| Admin suspends user | Hard delete all sessions for subject, broadcast |
| Session expires (inactivity) | Lazy delete on next access, or periodic sweep |
| Session expires (absolute) | Same — lazy or periodic |
| Fingerprint mismatch | Reject request, audit log entry, session NOT deleted (could be legitimate UA update) |

### Hard Deletes

Revoked and expired sessions are hard deleted immediately. No soft deletes, no `revoked_at` column. The audit log captures all session events (login, logout, revocation with actor) separately, so the session row is not needed for audit purposes.

### Periodic Cleanup

A background goroutine runs every hour, deleting sessions where:
- `expires_at < NOW()` (absolute expiry exceeded)
- `last_active < NOW() - 24 hours` (inactivity expiry exceeded)

### LRU Cache

Each daemon node maintains an in-memory LRU cache of validated sessions.

- **Capacity:** 10,000 sessions max
- **Entry TTL:** 60 seconds (re-validated against DB after 60s)
- **Eviction:** LRU eviction when at capacity, plus immediate eviction on revocation events
- **Cache hit:** Returns cached session claims without DB query
- **Cache miss:** Queries DB, populates cache on success
- **Cluster invalidation:** When a session is revoked on any node, a revocation event is broadcast via the existing Raft/cluster sync mechanism. All nodes evict the session from their local cache immediately.

### Fingerprinting

Computed on login: `SHA-256(User-Agent + Accept-Language)`. Stored in session row.

On every request:
1. Compute fingerprint from current request headers
2. Compare against stored fingerprint
3. If mismatch: reject with 401, create audit log entry ("fingerprint mismatch"), do NOT delete session
4. If match: proceed

Why not include IP: VPNs, mobile networks, and corporate proxies cause frequent IP changes. User-Agent + Accept-Language fingerprinting catches cross-device replay (stolen cookie on a different machine) without false positives from network changes.

---

## Part 2: Cookie Auth

### Cookie Configuration

```
Set-Cookie: rioku_sid=<session_id>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400
```

| Attribute | Value | Purpose |
|---|---|---|
| `HttpOnly` | Yes | JavaScript cannot read the cookie |
| `Secure` | Yes | Only sent over HTTPS (disabled in `--dev` mode) |
| `SameSite` | `Strict` | Cookie only sent on same-origin requests (CSRF protection) |
| `Path` | `/` | Available for all paths (API + admin panel) |
| `Max-Age` | `86400` | Browser expires cookie after 24h (matches sliding inactivity window) |

### Dev Mode

When running with `--dev`, the `Secure` flag is omitted so cookies work over `http://localhost`. A log warning is emitted: "dev mode: cookies not marked Secure".

### Auth Flow

**Login:**
1. User submits token/credentials to `POST /api/v1/auth/token`
2. Server validates credentials (bootstrap token, API key, or future username/password)
3. Server creates session row in DB
4. Server responds with `Set-Cookie: rioku_sid=<session_id>` and JSON body `{"subject", "roles", "expires_in"}`
5. Browser stores cookie automatically

**Every request:**
1. Browser sends cookie automatically
2. Auth middleware reads `rioku_sid` cookie
3. Checks LRU cache → if miss, queries DB
4. Validates: session exists, not expired (absolute + sliding), fingerprint matches
5. Updates `last_active` (debounced — at most once per minute to avoid write amplification)
6. Injects claims (`subject`, `roles`) into request context

**Logout:**
1. Client calls `POST /api/v1/auth/logout`
2. Server deletes session from DB + cache
3. Server responds with `Set-Cookie: rioku_sid=; Max-Age=0` (clears cookie)
4. Client redirects to `/login`

### Backwards Compatibility

The auth middleware checks in order:
1. `rioku_sid` cookie → session-based auth (admin panel)
2. `Authorization: Bearer <token>` header → JWT or API key auth (CLI, external integrations)

Both paths inject the same claims context. Downstream handlers don't know which auth method was used.

### SSE Auth

`EventSource` connections automatically include cookies (same-origin). No changes needed to the SSE implementation beyond removing the URL-param auth workaround. The session is validated during the initial HTTP request that establishes the SSE stream.

---

## Part 3: Security Headers

A new middleware applied to all responses. API responses (`/api/*`) get a subset (no CSP needed for JSON).

### Headers for Admin Panel (non-API paths)

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-XSS-Protection` | `0` (disabled — CSP replaces this) |

### Headers for API Responses

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

### CSP Notes

- `'unsafe-inline'` for `style-src` is required because Tailwind/shadcn inject inline styles
- `frame-ancestors 'none'` prevents clickjacking (equivalent to X-Frame-Options: DENY)
- `connect-src 'self'` restricts fetch/XHR/EventSource to same origin
- When plugins load external scripts (future), CSP will need to be relaxed per-plugin — this is an open question for the plugin security design

---

## Part 4: Route Loaders (Frontend)

### Pattern Change

Replace client-side `useQuery` data fetching with TanStack Router `loader` functions that prefetch data before the route renders.

**Before (current):**
```tsx
export const Route = createFileRoute('/')({
  component: Dashboard,
})

function Dashboard() {
  const { data: health, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.get<HealthStatus>('/health'),
  })
  if (isLoading) return <Skeleton />
  return <StatCard value={health.version} />
}
```

**After:**
```tsx
export const Route = createFileRoute('/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['health'],
      queryFn: () =>
        fetch('/api/v1/health', { credentials: 'include' })
          .then(r => r.json()),
    }),
  component: Dashboard,
})

function Dashboard() {
  const health = Route.useLoaderData()
  return <StatCard value={health.version} />
}
```

### Key Changes

**Data fetching:**
- Loaders call `queryClient.ensureQueryData()` — fetches if not cached, returns cached data if fresh
- Multiple loaders on the same route run in parallel (no waterfall)
- Components receive data synchronously via `useLoaderData()` — no loading skeletons for initial render
- `useQuery` still used for mutations (`useMutation`), polling intervals, and SSE subscriptions

**Auth:**
- All fetch calls use `credentials: 'include'` — browser sends cookie automatically
- No `Authorization` header construction in JS
- No `authStore`, no `getAuthHeader()`, no token management in client code

**Auth guard via `beforeLoad`:**
```tsx
// In __root.tsx or a layout route
beforeLoad: async ({ context }) => {
  const res = await fetch('/api/v1/auth/me', { credentials: 'include' })
  if (!res.ok) throw redirect({ to: '/login' })
  return { session: await res.json() }
}
```

**Router context provides `queryClient`:**
```tsx
// main.tsx
const queryClient = new QueryClient({ ... })
const router = createRouter({
  routeTree,
  context: { queryClient },
})
```

### Files That Change

**Deleted:**
- `src/lib/auth.ts` — token storage removed entirely

**Rewritten:**
- `src/lib/api.ts` — remove token management, add `credentials: 'include'` to all fetches
- `src/hooks/use-auth.ts` — replace with lightweight session hook (calls `/auth/me`, no token storage)
- `src/main.tsx` — pass `queryClient` into router context
- `src/routes/__root.tsx` — add `beforeLoad` auth check, remove `ProtectedRoute` wrapper
- `src/routes/login.tsx` — simplified, no token handling, just POST credentials and redirect
- Every route file — move `useQuery` to `loader`, use `useLoaderData`

**Deleted:**
- `src/components/auth/protected-route.tsx` — replaced by `beforeLoad` redirect

---

## Part 5: Session Management (Admin)

### New REST Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/v1/auth/me` | GET | Session cookie | Returns current session info. Lightweight — LRU cache only. |
| `/api/v1/auth/logout` | POST | Session cookie | Deletes session, clears cookie |
| `/api/v1/auth/sessions` | GET | Admin role | Lists all active sessions |
| `/api/v1/auth/sessions/{id}` | DELETE | Admin role | Revokes a specific session |
| `/api/v1/auth/sessions?subject={user}` | DELETE | Admin role | Revokes all sessions for a user |

### `/api/v1/auth/me` Response

```json
{
  "session_id": "abc123...",
  "subject": "admin",
  "roles": ["admin", "read", "write"],
  "created_at": "2026-04-07T12:00:00Z",
  "last_active": "2026-04-07T14:30:00Z",
  "expires_at": "2026-04-14T12:00:00Z",
  "ip_address": "192.168.1.10"
}
```

### `/api/v1/auth/sessions` Response

```json
{
  "sessions": [
    {
      "id": "abc123...",
      "subject": "admin",
      "ip_address": "192.168.1.10",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2026-04-07T12:00:00Z",
      "last_active": "2026-04-07T14:30:00Z",
      "is_current": true
    }
  ]
}
```

### Admin Panel UI

- Logout button in sidebar footer (always visible)
- Session management section on Security page: table of active sessions with "Revoke" button per row
- "Revoke all" button for a given user
- Current session highlighted, cannot be revoked from this view (use logout instead)

### Audit Logging

Every session event creates an audit entry:

| Event | Actor | Entity Type | Operation |
|---|---|---|---|
| Login | authenticated subject | `session` | `create` |
| Logout | authenticated subject | `session` | `delete` |
| Session revoked by admin | admin subject | `session` | `revoke` |
| All sessions revoked (user suspend) | admin subject | `session` | `revoke_all` |
| Fingerprint mismatch | system | `session` | `fingerprint_mismatch` |
| Session expired (cleanup) | system | `session` | `expire` |

---

## Part 6: Event Subscription Abstraction (SSE)

The existing SSE implementation continues to work with cookie auth. To prepare for a potential future WebSocket transport, the client-side subscription interface is abstracted:

```typescript
// src/hooks/use-events.ts
function useEventSubscription<T>(
  topic: string,
  options?: { enabled?: boolean },
): { data: T | null; status: 'connecting' | 'open' | 'closed'; error: Error | null }
```

This hook wraps `EventSource` today. If we add WebSocket support later, only this hook changes — all consumers stay the same.

**Topics:**
- `config.changes` — config mutation events
- `traffic.live` — live request stream
- `audit.events` — real-time audit entries
- Plugin-registered topics (future)

SSE endpoint: `GET /api/v1/events/{topic}` — cookie auth validated on connection, events streamed as `text/event-stream`.

---

## Migration Path

### Server-Side (Go)

1. Add `sessions` table via migration (all 3 dialects)
2. Add session CRUD to store interface + implementations
3. Build LRU session cache in `internal/auth/`
4. Add session management to auth package (create, validate, revoke, cleanup)
5. Update auth middleware: check cookie first, fall back to Bearer header
6. Add new endpoints (me, logout, sessions CRUD)
7. Add security headers middleware
8. Add session cleanup goroutine
9. Update SSE to use cookie auth

### Client-Side (React)

1. Delete `src/lib/auth.ts`
2. Rewrite `src/lib/api.ts` (drop token management, add `credentials: 'include'`)
3. Rewrite `src/hooks/use-auth.ts` (session check via `/auth/me`)
4. Create `src/hooks/use-events.ts` (SSE abstraction)
5. Update `src/main.tsx` (router context with queryClient)
6. Update `src/routes/__root.tsx` (beforeLoad auth, remove ProtectedRoute)
7. Rewrite `src/routes/login.tsx` (no token storage)
8. Convert every route file to use loaders
9. Add logout button to sidebar
10. Add session management UI to Security page

---

## Open Questions

- **Deeper security audit:** Rate limiting on auth endpoints, account lockout after N failed attempts, session concurrency limits (max N sessions per user), CSP tuning when plugins load external scripts. These should be addressed in a dedicated security hardening pass after the base session system is in place.
- **WebSocket transport:** SSE handles current needs. If plugins require bidirectional real-time communication, add WebSocket support behind the same `useEventSubscription` abstraction. `coder/websocket` is the recommended Go library.
- **Password-based auth:** Current auth uses bootstrap tokens and API keys. Username/password auth with proper password hashing (argon2id) is a future addition that will use the same session infrastructure.

---

## Verification Checklist

- [ ] Login with bootstrap token → session created in DB, HttpOnly cookie set
- [ ] Subsequent requests authenticated via cookie (no JS token handling)
- [ ] `GET /api/v1/auth/me` returns session info
- [ ] Logout clears cookie and deletes session from DB
- [ ] Page refresh after logout redirects to login
- [ ] Admin can list all active sessions
- [ ] Admin can revoke a specific session → user immediately gets 401
- [ ] Admin can revoke all sessions for a user → all their browsers get 401
- [ ] Fingerprint mismatch (different User-Agent) → request rejected with 401
- [ ] Fingerprint mismatch creates audit log entry
- [ ] Session expires after 24h inactivity → next request gets 401
- [ ] Session expires after 7 days regardless of activity
- [ ] Periodic cleanup removes expired sessions from DB
- [ ] LRU cache serves session lookups without DB hit (within 60s TTL)
- [ ] Cache eviction on revocation is immediate
- [ ] CLI with `--token` flag still works (Bearer header auth)
- [ ] API keys still work via Bearer header
- [ ] Security headers present on admin panel responses
- [ ] CSP blocks inline scripts (except allowed sources)
- [ ] X-Frame-Options prevents iframe embedding
- [ ] Route loaders fetch data before page renders (no skeleton flash on navigation)
- [ ] Multiple loaders on same route run in parallel
- [ ] SSE connects with cookie auth (no URL param)
- [ ] `useEventSubscription` hook works for config changes and live traffic
- [ ] Audit log records all session events (login, logout, revoke, expire, fingerprint mismatch)
- [ ] Dev mode: cookies work over HTTP (Secure flag omitted)
- [ ] Cluster: session revocation broadcasts to all nodes, caches evict
