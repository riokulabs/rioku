# Design: Auth Security Overhaul — User Accounts, Sessions, RBAC, 2FA, Security Headers, Route Loaders

## Context

The admin panel currently uses in-memory JWT Bearer tokens managed by client-side JavaScript. There is no user account system — authentication is token-only (bootstrap tokens, API keys). There is no server-side session store, no HttpOnly cookies, no security headers, no RBAC, no logout button, and no 2FA. Data fetching happens client-side via `useQuery`, causing loading skeleton waterfalls.

This design replaces the entire auth system with:
- User accounts with username/password authentication
- Server-side session management with HttpOnly cookies
- Role-based access control (RBAC)
- TOTP two-factor authentication
- Configurable password policies and account lockout
- Security headers (CSP, X-Frame-Options, etc.)
- Per-session and per-user rate limiting
- TanStack Router route loaders for data fetching
- SSE auth via cookies

## Goals

- Proper user account system (username/password for web UI, tokens/API keys for programmatic access)
- Tokens invisible to JavaScript (HttpOnly cookies)
- Server can revoke any session instantly
- Session fingerprinting prevents cookie replay
- RBAC with configurable roles and permissions
- TOTP 2FA (Google Authenticator compatible, no external service)
- Configurable password policies (enterprises can enforce their own)
- Account lockout after failed attempts
- Full security header suite
- Data fetching via route loaders (no loading waterfalls)
- Backwards compatible with CLI/API key Bearer auth
- Cluster-aware session caching with instant revocation broadcast

---

## Part 1: User Accounts

### Users Table

```sql
CREATE TABLE users (
    id                  TEXT PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE,
    email               TEXT,
    display_name        TEXT,
    password_hash       TEXT NOT NULL,
    role                TEXT NOT NULL DEFAULT 'viewer',
    status              TEXT NOT NULL DEFAULT 'active',
    totp_secret         TEXT,
    totp_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts     INTEGER NOT NULL DEFAULT 0,
    locked_until        TIMESTAMP,
    last_login          TIMESTAMP,
    password_changed_at TIMESTAMP NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX idx_users_username ON users(username);
```

- `id`: UUID v4 (cryptographically random, not predictable)
- `username`: Unique, case-insensitive (stored lowercase)
- `password_hash`: Argon2id hash (see Password Security section)
- `role`: One of the RBAC roles (see Part 3)
- `status`: `active`, `suspended`, `locked` (locked = automatic from failed attempts, suspended = admin action)
- `totp_secret`: Base32-encoded TOTP shared secret (encrypted at rest via keyring)
- `force_password_change`: Set on account creation and admin-triggered password resets
- `failed_attempts`: Counter for account lockout (reset on successful login)
- `locked_until`: Timestamp when lockout expires (null = not locked)

### Root User Initialization

During `rioku init`:
1. Create a `root` user with a cryptographically random 24-character password
2. Set `role = 'superadmin'`, `force_password_change = true`
3. Print the credentials once:
   ```
   Root account created:
     Username: root
     Password: aB3$kL9mNp2xQr7wYz4vHj6t
     
   Save this — it will not be shown again.
   You will be required to change this password on first login.
   ```
4. The bootstrap token mechanism still exists as a fallback for headless/automated setups

### Password Security

**Hashing: Argon2id** (Go stdlib `crypto` doesn't include argon2, but `golang.org/x/crypto/argon2` is the official extended stdlib — acceptable given the project already uses `golang.org/x/` packages)

Default parameters:
- Memory: 64 MB
- Iterations: 3
- Parallelism: 4
- Salt: 16 bytes (crypto/rand)
- Key length: 32 bytes
- Format: `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`

**Configurable password policy** (stored in daemon config YAML):

```yaml
auth:
  password_policy:
    min_length: 12          # minimum password length
    require_uppercase: true  # at least one uppercase letter
    require_lowercase: true  # at least one lowercase letter
    require_digit: true      # at least one digit
    require_special: false   # at least one special character
    max_age_days: 0          # 0 = never expires, >0 = force change after N days
    history_count: 0         # 0 = no history check, >0 = prevent reusing last N passwords
```

Defaults are secure but not obnoxious. Enterprises can tighten via config.

**Password validation:**
- Check against policy on creation and change
- Return clear error messages: "Password must be at least 12 characters" (not "invalid password")
- If `history_count > 0`, store previous password hashes in a `password_history` table and reject reuse

### Account Lockout

**Configurable:**
```yaml
auth:
  lockout:
    max_attempts: 5         # lock after N consecutive failed attempts
    lockout_duration: 15m   # how long the account stays locked
    reset_after: 30m        # reset attempt counter after N minutes of no failures
```

**Behavior:**
- Each failed login increments `failed_attempts` on the user row
- When `failed_attempts >= max_attempts`: set `locked_until = NOW() + lockout_duration`, set `status = 'locked'`
- While locked: login returns 423 Locked with `Retry-After` header
- After lockout expires: next login attempt checks password normally, resets counter on success
- Admin can manually unlock a user at any time
- Successful login always resets `failed_attempts` to 0

### Credential Change → Session Invalidation

When any of these change, ALL sessions for that user are revoked (except the current session performing the change):

| Change | Sessions revoked | Rationale |
|---|---|---|
| Password change | All other sessions | Compromised password → revoke everything |
| Email change | All other sessions | Possible account takeover indicator |
| Username change | All other sessions | Identity change |
| Role change (admin action) | All sessions for user | Permissions changed, force re-auth |
| TOTP enabled/disabled | All other sessions | Security posture changed |
| Account suspended | All sessions | Immediate lockout |

### Auth Endpoints (User Accounts)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `POST /api/v1/auth/login` | POST | None | Username/password login (+ optional TOTP code) |
| `POST /api/v1/auth/token` | POST | None | Token exchange (bootstrap token, API key) — backwards compat |
| `POST /api/v1/auth/logout` | POST | Session | Logout, clear session |
| `GET /api/v1/auth/me` | GET | Session | Current session + user info |
| `POST /api/v1/auth/password` | POST | Session | Change own password |
| `GET /api/v1/users` | GET | Admin | List all users |
| `POST /api/v1/users` | POST | Superadmin | Create user |
| `GET /api/v1/users/{id}` | GET | Admin | Get user details |
| `PUT /api/v1/users/{id}` | PUT | Admin | Update user (role, status, etc.) |
| `DELETE /api/v1/users/{id}` | DELETE | Superadmin | Delete user (revokes all sessions) |
| `POST /api/v1/users/{id}/reset-password` | POST | Admin | Force password reset (sets `force_password_change`) |
| `POST /api/v1/users/{id}/unlock` | POST | Admin | Manually unlock locked account |
| `POST /api/v1/users/{id}/suspend` | POST | Admin | Suspend user (revokes all sessions) |
| `POST /api/v1/users/{id}/activate` | POST | Admin | Reactivate suspended user |

### Login Flow

```
POST /api/v1/auth/login
{
  "username": "admin",
  "password": "...",
  "totp_code": "123456"    // optional, required if TOTP enabled
}
```

**Server logic:**
1. Find user by username (case-insensitive)
2. Check `status` — if `locked`, check `locked_until`. If still locked, return 423.
3. Check `status` — if `suspended`, return 403.
4. Verify password against `password_hash` (argon2id)
5. If wrong: increment `failed_attempts`, check lockout threshold, return 401
6. If correct: reset `failed_attempts` to 0
7. If `totp_enabled` and no `totp_code` provided: return 401 with `{"requires_totp": true}`
8. If `totp_enabled` and `totp_code` provided: validate TOTP code
9. If TOTP wrong: return 401 (does NOT increment failed_attempts — password was correct)
10. Create session, set cookie
11. If `force_password_change`: return 200 with `{"force_password_change": true}` — admin panel redirects to password change form
12. Update `last_login` on user row

**Response (200):**
```json
{
  "user": {
    "id": "uuid",
    "username": "admin",
    "display_name": "Admin User",
    "role": "superadmin",
    "totp_enabled": false,
    "force_password_change": true
  },
  "session": {
    "id": "session-uuid",
    "expires_at": "2026-04-14T12:00:00Z"
  }
}
```

---

## Part 2: TOTP Two-Factor Authentication

### Implementation

TOTP per RFC 6238 — implemented in Go stdlib (`crypto/hmac`, `crypto/sha1`, `encoding/binary`, `time`). No external library needed. ~50 lines of code.

- Algorithm: HMAC-SHA1 (standard, compatible with all authenticator apps)
- Digits: 6
- Period: 30 seconds
- Secret: 20 bytes (160 bits), base32-encoded for QR code
- Window: Accept current period ± 1 (allows 30s clock skew)

### TOTP Setup Flow

1. User calls `POST /api/v1/auth/totp/setup` (authenticated)
2. Server generates random 20-byte secret
3. Server returns:
   ```json
   {
     "secret": "JBSWY3DPEHPK3PXP...",
     "qr_uri": "otpauth://totp/Rioku:admin?secret=JBSWY3DPEHPK3PXP&issuer=Rioku&algorithm=SHA1&digits=6&period=30",
     "backup_codes": ["12345678", "87654321", ...]
   }
   ```
4. Admin panel shows QR code (generated client-side from `qr_uri`) + manual secret entry
5. User scans with authenticator app
6. User enters current TOTP code to confirm: `POST /api/v1/auth/totp/verify` with `{"code": "123456"}`
7. Server validates code → if correct, saves secret to user row, sets `totp_enabled = true`
8. All other sessions for user are revoked (security posture changed)

### Backup Codes

- 10 single-use 8-digit backup codes generated during TOTP setup
- Stored as argon2id hashes in a `totp_backup_codes` table
- Each code can be used exactly once (deleted after use)
- If all backup codes used, user must contact admin for manual TOTP reset

```sql
CREATE TABLE totp_backup_codes (
    id        TEXT PRIMARY KEY,
    user_id   TEXT NOT NULL REFERENCES users(id),
    code_hash TEXT NOT NULL,
    used_at   TIMESTAMP
);
```

### TOTP Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `POST /api/v1/auth/totp/setup` | POST | Session | Generate TOTP secret + QR URI + backup codes |
| `POST /api/v1/auth/totp/verify` | POST | Session | Confirm TOTP setup with a code |
| `POST /api/v1/auth/totp/disable` | POST | Session | Disable TOTP (requires current password + TOTP code) |
| `POST /api/v1/users/{id}/totp/reset` | POST | Admin | Admin resets user's TOTP (clears secret, disables 2FA) |

### TOTP Secret Storage

The TOTP secret is encrypted at rest using the daemon's signing key (AES-256-GCM). The `totp_secret` column stores the encrypted+base64-encoded ciphertext, not the raw base32 secret. Decrypted only when validating a TOTP code.

---

## Part 3: Role-Based Access Control (RBAC)

### Roles

| Role | Description | Permissions |
|---|---|---|
| `superadmin` | Root/system administrator | Everything. Can create/delete users, manage roles. Only role that can delete other superadmins. |
| `admin` | Instance administrator | Manage config (routes, services, policies), manage API keys, view audit log, manage users (except superadmin), manage sessions. Cannot delete superadmin accounts. |
| `operator` | Day-to-day operations | Manage config (routes, services, policies), view audit log, manage own API keys. Cannot manage users or sessions. |
| `viewer` | Read-only access | View config, view traffic, view audit log. Cannot modify anything. |

### Permission Matrix

| Resource | superadmin | admin | operator | viewer |
|---|---|---|---|---|
| Config: read | yes | yes | yes | yes |
| Config: write | yes | yes | yes | no |
| API keys: own | yes | yes | yes | no |
| API keys: all | yes | yes | no | no |
| Users: manage | yes | yes | no | no |
| Users: create/delete | yes | no | no | no |
| Sessions: manage | yes | yes | no | no |
| Audit: read | yes | yes | yes | yes |
| Settings: read | yes | yes | yes | yes |
| Settings: write | yes | yes | no | no |
| Traffic: read | yes | yes | yes | yes |

### Enforcement

Permissions checked in the auth middleware after session validation. The claims context includes `role`, and each endpoint handler checks against the required permission level.

A `RequireRole(minRole)` middleware helper simplifies this:
```go
// Usage in route registration
mux.Handle("POST /api/v1/users", RequireRole("superadmin", handler))
mux.Handle("DELETE /api/v1/keys/{id}", RequireRole("admin", handler))
mux.Handle("POST /api/v1/config", RequireRole("operator", handler))
```

Role hierarchy: `superadmin > admin > operator > viewer`. `RequireRole("operator")` allows operator, admin, and superadmin.

### Future: Custom Roles

The current design uses fixed roles. A future module can extend this to custom roles with granular permissions. The RBAC enforcement layer is built to accept a permission check function, not just a role string, so it can be extended without rewriting the middleware.

---

## Part 4: Session Store

### Sessions Table

```sql
CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id),
    fingerprint   TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL,
    expires_at    TIMESTAMP NOT NULL,
    last_active   TIMESTAMP NOT NULL,
    ip_address    TEXT,
    user_agent    TEXT
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

- `id`: UUID v4 (cryptographically random, unpredictable)
- `user_id`: References the users table (replaces the old `subject` text field)
- `fingerprint`: SHA-256 hash of `User-Agent + Accept-Language`
- `expires_at`: Absolute maximum session lifetime (7 days from creation)
- `last_active`: Sliding expiry tracker (session dies after 24h of inactivity)
- `ip_address`: For audit visibility, NOT used for fingerprinting
- `user_agent`: For admin visibility in session list

### Session Lifecycle

| Event | Action |
|---|---|
| Login (password or token) | Create session row, set cookie |
| Every request | Validate session (cache → DB fallback), update `last_active` |
| Logout | Hard delete session row, clear cookie |
| Admin revokes session | Hard delete row, broadcast revocation to cluster |
| Admin suspends user | Hard delete all sessions for user, broadcast |
| Credential change | Hard delete all OTHER sessions for user, broadcast |
| Session expires (inactivity) | Lazy delete on next access, or periodic sweep |
| Session expires (absolute) | Same — lazy or periodic |
| Fingerprint mismatch | Reject request, audit log entry, session NOT deleted |

### Hard Deletes

Revoked and expired sessions are hard deleted immediately. The audit log captures all session events separately.

### Periodic Cleanup

Background goroutine runs every hour:
- Delete sessions where `expires_at < NOW()`
- Delete sessions where `last_active < NOW() - 24 hours`

### LRU Cache

Per-node in-memory cache of validated sessions:

- **Capacity:** 10,000 sessions max
- **Entry TTL:** 60 seconds (re-validated against DB after 60s)
- **Eviction:** LRU eviction at capacity, immediate eviction on revocation
- **Cache hit:** Returns cached session + user claims without DB query
- **Cache miss:** Queries DB (joins sessions + users for role/status), populates cache
- **Cluster invalidation:** Revocation events broadcast via Raft/cluster sync → all nodes evict immediately

### Fingerprinting

Computed on login: `SHA-256(User-Agent + Accept-Language)`. Stored in session row.

On every request:
1. Compute fingerprint from current headers
2. Compare against stored fingerprint
3. Mismatch → 401, audit entry ("fingerprint mismatch"), session NOT deleted
4. Match → proceed

---

## Part 5: Cookie Auth

### Cookie Configuration

```
Set-Cookie: rioku_sid=<session_id>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400
```

| Attribute | Value | Purpose |
|---|---|---|
| `HttpOnly` | Yes | JavaScript cannot read the cookie |
| `Secure` | Yes | Only sent over HTTPS (disabled in `--dev` mode) |
| `SameSite` | `Strict` | CSRF protection — cookie only sent same-origin |
| `Path` | `/` | Available for all paths |
| `Max-Age` | `86400` | Browser expires after 24h (matches sliding window) |

### Dev Mode

`--dev` omits `Secure` flag. Warning logged: "dev mode: cookies not marked Secure".

### Auth Middleware Priority

1. `rioku_sid` cookie → session-based auth (admin panel, web users)
2. `Authorization: Bearer <token>` → API key auth (CLI, external integrations)

Both paths inject the same claims context (`user_id`, `username`, `role`). Downstream handlers are auth-method-agnostic.

### SSE Auth

`EventSource` includes cookies automatically on same-origin. Session validated during the initial HTTP request.

---

## Part 6: Rate Limiting

### Per-Session Rate Limiting

Limits how fast a single session can make requests. Prevents a compromised session from hammering the API.

```yaml
auth:
  rate_limit:
    per_session:
      requests: 100     # max requests per window
      window: 10s       # sliding window duration
```

Implemented as in-memory sliding window counter keyed by session ID. Returns 429 with `Retry-After` header when exceeded.

### Per-User Rate Limiting

Limits total requests across all sessions for a single user. Prevents a user from circumventing per-session limits by opening many sessions.

```yaml
auth:
  rate_limit:
    per_user:
      requests: 300     # max requests per window across all sessions
      window: 10s
```

Keyed by `user_id`. Same sliding window implementation.

### Auth Endpoint Rate Limiting

Login endpoint gets its own rate limit to prevent brute force:

```yaml
auth:
  rate_limit:
    login:
      requests: 10      # max login attempts per window
      window: 60s       # per IP address
```

Keyed by client IP. Applied before authentication (protects against credential stuffing).

---

## Part 7: Security Headers

Middleware applied to all responses.

### Headers for Admin Panel (non-API paths)

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-XSS-Protection` | `0` |

### Headers for API Responses

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

### CSP Notes

- `'unsafe-inline'` for styles required by Tailwind/shadcn
- `frame-ancestors 'none'` prevents clickjacking
- `connect-src 'self'` restricts fetch/XHR/EventSource to same origin
- Plugin CSP relaxation is a future open question

---

## Part 8: Route Loaders (Frontend)

### Pattern Change

Replace `useQuery` in components with TanStack Router `loader` functions.

**After:**
```tsx
export const Route = createFileRoute('/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['health'],
      queryFn: () =>
        fetch('/api/v1/health', { credentials: 'include' }).then(r => r.json()),
    }),
  component: Dashboard,
})

function Dashboard() {
  const health = Route.useLoaderData()
  return <StatCard value={health.version} />
}
```

### Key Changes

- Loaders call `queryClient.ensureQueryData()` — prefetch before render
- Multiple loaders run in parallel (no waterfall)
- Components get data synchronously via `useLoaderData()`
- `useQuery` still used for mutations, polling, SSE subscriptions
- All fetch calls use `credentials: 'include'`
- No token management in JS — cookie handles auth

### Auth Guard

```tsx
// __root.tsx
beforeLoad: async ({ context, location }) => {
  if (location.pathname === '/login') return
  const res = await fetch('/api/v1/auth/me', { credentials: 'include' })
  if (!res.ok) throw redirect({ to: '/login' })
  const session = await res.json()
  if (session.user.force_password_change && location.pathname !== '/change-password') {
    throw redirect({ to: '/change-password' })
  }
  return { session }
}
```

### Admin Panel UI Changes

**New pages:**
- `/login` — username/password form with optional TOTP field
- `/change-password` — forced password change form (shown when `force_password_change` is true)
- `/settings/profile` — user profile, change password, TOTP setup/disable
- `/settings/users` — user management (admin only): list, create, edit, suspend, delete, reset password, reset TOTP

**Modified pages:**
- Sidebar footer: logout button + current user display
- Security page: session management section (list active sessions, revoke)

### Files That Change

**Deleted:**
- `src/lib/auth.ts`
- `src/components/auth/protected-route.tsx`

**New:**
- `src/routes/change-password.tsx`
- `src/routes/settings/profile.tsx`
- `src/routes/settings/users.tsx`
- `src/hooks/use-events.ts` (SSE abstraction)

**Rewritten:**
- `src/lib/api.ts` — drop token management, add `credentials: 'include'`
- `src/hooks/use-auth.ts` — lightweight session hook via `/auth/me`
- `src/main.tsx` — router context with `queryClient`
- `src/routes/__root.tsx` — `beforeLoad` auth guard with force-password-change redirect
- `src/routes/login.tsx` — username/password + TOTP form
- `src/routes/security.tsx` — add session management
- Every route file — move `useQuery` to `loader`

---

## Part 9: Event Subscription Abstraction (SSE)

Client-side subscription interface abstracted for future WebSocket transport:

```typescript
function useEventSubscription<T>(
  topic: string,
  options?: { enabled?: boolean },
): { data: T | null; status: 'connecting' | 'open' | 'closed'; error: Error | null }
```

Wraps `EventSource` today. Transport-agnostic for consumers.

**Topics:** `config.changes`, `traffic.live`, `audit.events`, plugin-registered topics (future).

**Endpoint:** `GET /api/v1/events/{topic}` — cookie auth on connection.

---

## Part 10: Admin Panel Session Management

### Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/v1/auth/me` | GET | Session | Current session + user info |
| `POST /api/v1/auth/logout` | POST | Session | Delete session, clear cookie |
| `GET /api/v1/auth/sessions` | GET | Admin | List all active sessions |
| `DELETE /api/v1/auth/sessions/{id}` | DELETE | Admin | Revoke specific session |
| `DELETE /api/v1/auth/sessions?user_id={id}` | DELETE | Admin | Revoke all sessions for user |

### `/api/v1/auth/me` Response

```json
{
  "session": {
    "id": "uuid",
    "created_at": "2026-04-07T12:00:00Z",
    "last_active": "2026-04-07T14:30:00Z",
    "expires_at": "2026-04-14T12:00:00Z",
    "ip_address": "192.168.1.10"
  },
  "user": {
    "id": "uuid",
    "username": "admin",
    "display_name": "Admin User",
    "email": "admin@example.com",
    "role": "superadmin",
    "totp_enabled": true,
    "force_password_change": false
  }
}
```

### Audit Logging

Every auth event creates an audit entry:

| Event | Actor | Entity Type | Operation |
|---|---|---|---|
| Login (success) | user | `session` | `create` |
| Login (failed) | system | `auth` | `login_failed` |
| Logout | user | `session` | `delete` |
| Session revoked | admin | `session` | `revoke` |
| All sessions revoked | admin | `session` | `revoke_all` |
| Fingerprint mismatch | system | `session` | `fingerprint_mismatch` |
| Account locked | system | `user` | `lock` |
| Account unlocked | admin | `user` | `unlock` |
| Account suspended | admin | `user` | `suspend` |
| Account activated | admin | `user` | `activate` |
| Password changed | user | `user` | `password_change` |
| Password reset (admin) | admin | `user` | `password_reset` |
| TOTP enabled | user | `user` | `totp_enable` |
| TOTP disabled | user | `user` | `totp_disable` |
| TOTP reset (admin) | admin | `user` | `totp_reset` |
| User created | admin | `user` | `create` |
| User deleted | admin | `user` | `delete` |
| Role changed | admin | `user` | `role_change` |

---

## Migration Path

### Server-Side (Go)

1. Add `users` table + `sessions` table + `totp_backup_codes` table via migration (all 3 dialects)
2. Add user CRUD + session CRUD to store interface + implementations
3. Implement argon2id password hashing in `internal/auth/`
4. Implement TOTP generation + validation in `internal/auth/`
5. Build LRU session cache
6. Add session management (create, validate, revoke, cleanup)
7. Add password policy validation (configurable)
8. Add account lockout logic
9. Implement RBAC middleware (`RequireRole`)
10. Update auth middleware: cookie first, Bearer fallback, fingerprint check
11. Add rate limiting middleware (per-session, per-user, per-IP for login)
12. Add user management endpoints
13. Add TOTP endpoints
14. Add security headers middleware
15. Update `rioku init` to create root user
16. Add session cleanup goroutine
17. Update SSE to use cookie auth

### Client-Side (React)

1. Delete `src/lib/auth.ts`
2. Rewrite `src/lib/api.ts` (credentials: 'include')
3. Rewrite `src/hooks/use-auth.ts` (session check via /auth/me)
4. Create `src/hooks/use-events.ts` (SSE abstraction)
5. Update `src/main.tsx` (router context)
6. Update `src/routes/__root.tsx` (beforeLoad auth + force-password-change)
7. Rewrite `src/routes/login.tsx` (username/password + TOTP)
8. Create `src/routes/change-password.tsx`
9. Create `src/routes/settings/profile.tsx` (profile + TOTP setup)
10. Create `src/routes/settings/users.tsx` (user management)
11. Update `src/routes/security.tsx` (session management)
12. Convert all route files to loaders
13. Add logout button + user display to sidebar

---

## Open Questions

- **SSO module:** Basic username/password auth is the foundation. SSO (OIDC, SAML) can be added as a module that creates users on first login and maps external roles to Rioku roles. The user/session infrastructure supports this without changes.
- **Custom RBAC:** Current fixed roles (superadmin/admin/operator/viewer) cover common cases. A future module can extend to custom roles with granular permissions. The middleware is built to accept a permission check function, not just role comparison.
- **Plugin CSP:** When plugins load external scripts, CSP needs per-plugin relaxation. Deferred to plugin security design.
- **WebSocket transport:** SSE covers current needs. `coder/websocket` recommended if bidirectional communication needed. Same `useEventSubscription` abstraction.
- **Password breach checking:** Could integrate with HaveIBeenPwned API to check passwords against known breaches. Deferred — optional future enhancement.

---

## Verification Checklist

### User Accounts
- [ ] `rioku init` creates root user with random password, prints once
- [ ] Root user must change password on first login
- [ ] Login with username/password → session created, cookie set
- [ ] Login with wrong password → 401, failed_attempts incremented
- [ ] Account locks after N failed attempts → 423 response
- [ ] Locked account auto-unlocks after lockout duration
- [ ] Admin can manually unlock account
- [ ] Admin can suspend user → all sessions revoked, login blocked
- [ ] Admin can activate suspended user
- [ ] Password change → all other sessions revoked
- [ ] Password validation enforces configurable policy
- [ ] User CRUD: create, list, get, update, delete (role-appropriate access)

### TOTP 2FA
- [ ] TOTP setup returns secret + QR URI + backup codes
- [ ] TOTP verification with authenticator app code works
- [ ] Login requires TOTP code when 2FA is enabled
- [ ] Backup code works as TOTP substitute (single use)
- [ ] Admin can reset user's TOTP
- [ ] TOTP secret encrypted at rest

### RBAC
- [ ] Superadmin can access everything
- [ ] Admin cannot delete superadmin accounts
- [ ] Operator can manage config but not users
- [ ] Viewer is read-only — all writes return 403
- [ ] Role change → all sessions for user revoked

### Sessions
- [ ] Cookie: HttpOnly, Secure (except dev), SameSite=Strict
- [ ] Session validated on every request (cache → DB)
- [ ] Fingerprint mismatch → 401
- [ ] 24h inactivity → session expired
- [ ] 7 day absolute → session expired
- [ ] Admin can list/revoke sessions
- [ ] Cluster: revocation broadcasts, caches evict immediately

### Rate Limiting
- [ ] Per-session rate limit enforced (429 when exceeded)
- [ ] Per-user rate limit enforced across multiple sessions
- [ ] Login endpoint rate limited per IP

### Security Headers
- [ ] CSP present on admin panel responses
- [ ] X-Frame-Options: DENY on all responses
- [ ] X-Content-Type-Options: nosniff on all responses

### Route Loaders
- [ ] Data fetched in loaders before page renders
- [ ] No skeleton flash on cached navigation
- [ ] SSE works with cookie auth
- [ ] Logout redirects to login, clears cookie
- [ ] Force password change redirects to change-password form

### Backwards Compatibility
- [ ] CLI with `--token` flag still works (Bearer header)
- [ ] API keys still work via Bearer header
- [ ] Bootstrap token exchange still works
