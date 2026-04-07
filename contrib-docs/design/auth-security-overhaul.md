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
- `status`: `active`, `suspended`, `locked` (locked = automatic from failed attempts, suspended = admin action)
- Roles are assigned via the `user_roles` join table (see Part 3: RBAC), not stored on the user row
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

| Endpoint | Method | Permission | Purpose |
|---|---|---|---|
| `POST /api/v1/auth/login` | POST | None | Username/password login (+ optional TOTP code) |
| `POST /api/v1/auth/token` | POST | None | Token exchange (bootstrap token, API key) — backwards compat |
| `POST /api/v1/auth/logout` | POST | Any session | Logout, clear session |
| `GET /api/v1/auth/me` | GET | Any session | Current session + user info + permissions |
| `PATCH /api/v1/auth/me` | PATCH | Any session | Update own profile (display_name, email) |
| `POST /api/v1/auth/password` | POST | Any session | Change own password |
| `GET /api/v1/users` | GET | `users:read` | List all users |
| `POST /api/v1/users` | POST | `users:create` | Create user |
| `GET /api/v1/users/{id}` | GET | `users:read` | Get user details |
| `PATCH /api/v1/users/{id}` | PATCH | `users:manage` | Update user (status, display name, email) |
| `DELETE /api/v1/users/{id}` | DELETE | `users:delete` | Delete user (cascades: revokes sessions, removes role assignments) |
| `POST /api/v1/users/{id}/reset-password` | POST | `users:manage` | Force password reset (sets `force_password_change`) |
| `POST /api/v1/users/{id}/unlock` | POST | `users:manage` | Manually unlock locked account |
| `POST /api/v1/users/{id}/suspend` | POST | `users:manage` | Suspend user (revokes all sessions) |
| `POST /api/v1/users/{id}/activate` | POST | `users:manage` | Reactivate suspended user |
| `POST /api/v1/users/{id}/roles` | POST | `roles:manage` | Assign role to user |
| `DELETE /api/v1/users/{id}/roles/{role_id}` | DELETE | `roles:manage` | Remove role from user |

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
    "roles": ["superadmin"],
    "permissions": ["config:read", "config:write", "users:create", "..."],
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

Proper relational RBAC with normalized tables, composite keys on join tables, and permission-based enforcement.

### Schema

```sql
-- Atomic permissions — the finest-grained access control unit.
-- Seeded on migration, extensible by plugins.
CREATE TABLE permissions (
    id          TEXT PRIMARY KEY,     -- e.g. 'config:read', 'users:create'
    resource    TEXT NOT NULL,        -- e.g. 'config', 'users', 'sessions'
    action      TEXT NOT NULL,        -- e.g. 'read', 'write', 'create', 'delete', 'manage'
    description TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(resource, action)
);

-- Named collections of permissions.
-- Built-in roles are seeded; admins can create custom roles.
CREATE TABLE roles (
    id          TEXT PRIMARY KEY,     -- UUID
    name        TEXT NOT NULL UNIQUE, -- e.g. 'superadmin', 'operator', 'my-custom-role'
    description TEXT NOT NULL,
    is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many: which permissions each role grants.
-- Composite PK — no surrogate ID on a pure relationship table.
CREATE TABLE role_permissions (
    role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);

-- Many-to-many: which roles each user has.
-- Composite PK — no surrogate ID on a pure relationship table.
CREATE TABLE user_roles (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_by TEXT REFERENCES users(id),            -- who assigned this role
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
```

**Design notes:**
- `ON DELETE CASCADE` on join tables — deleting a role automatically removes all assignments. Deleting a user removes their role assignments and sessions.
- Composite primary keys on `role_permissions` and `user_roles` — these are pure relationship tables, no surrogate ID needed.
- Indexes on FK columns match query patterns: "get all roles for user X" and "get all users with role Y".
- `is_builtin` prevents accidental deletion of system roles.
- `granted_by` tracks who assigned a role for audit trail.

### Seed Permissions

Seeded during migration. These are the atomic permission units:

| ID | Resource | Action | Description |
|---|---|---|---|
| `config:read` | config | read | View routes, services, policies |
| `config:write` | config | write | Create, update, delete routes/services/policies |
| `config:import` | config | import | Import full config (replaces all) |
| `config:export` | config | export | Export config snapshot |
| `keys:own` | keys | own | Manage own API keys |
| `keys:manage` | keys | manage | Manage all API keys |
| `users:read` | users | read | View user list and details |
| `users:manage` | users | manage | Update users, change roles, reset passwords |
| `users:create` | users | create | Create new user accounts |
| `users:delete` | users | delete | Delete user accounts |
| `roles:read` | roles | read | View roles and permissions |
| `roles:manage` | roles | manage | Create, update, delete custom roles |
| `sessions:read` | sessions | read | View active sessions |
| `sessions:manage` | sessions | manage | Revoke other users' sessions |
| `audit:read` | audit | read | View audit log |
| `settings:read` | settings | read | View daemon settings |
| `settings:write` | settings | write | Modify daemon settings |
| `traffic:read` | traffic | read | View live traffic and analytics |
| `plugins:read` | plugins | read | View installed plugins |
| `plugins:manage` | plugins | manage | Install, remove, configure plugins |
| `cluster:read` | cluster | read | View cluster status |
| `cluster:manage` | cluster | manage | Join/remove nodes |

### Seed Roles

Four built-in roles seeded during migration, marked `is_builtin = true`:

**superadmin** — All permissions. The root account's default role.

**admin** — Everything except `users:create`, `users:delete`, `roles:manage`, `cluster:manage`. Can manage existing users and sessions but cannot create/delete accounts or modify the role structure.

**operator** — `config:read`, `config:write`, `config:import`, `config:export`, `keys:own`, `audit:read`, `settings:read`, `traffic:read`, `plugins:read`, `cluster:read`. Day-to-day operations without user/session management.

**viewer** — `config:read`, `audit:read`, `settings:read`, `traffic:read`, `plugins:read`, `cluster:read`. Read-only everywhere.

### Hierarchical Permissions (Scope-Based)

Permissions follow a hierarchical `resource:action` pattern with wildcard support. A user granted `config:*` automatically has `config:read`, `config:write`, `config:import`, and `config:export`. The special `*` permission grants everything.

**Hierarchy rules:**
- `config:read` — matches exactly `config:read`
- `config:*` — matches any permission starting with `config:`
- `*` — matches all permissions (superadmin wildcard)

**Storage:** The `role_permissions` table stores the granted scope strings. A role can have both granular (`config:read`) and wildcard (`config:*`) entries. The session cache resolves these into a flat set for fast lookup.

**Resolution at session creation:**

```sql
-- Get all granted scopes for a user (across all roles)
SELECT DISTINCT rp.permission_id 
FROM user_roles ur
JOIN role_permissions rp ON ur.role_id = rp.role_id
WHERE ur.user_id = ?;
```

The resulting scope set is stored in the session cache. The `HasPermission` check expands wildcards:

```go
type SessionClaims struct {
    SessionID   string
    UserID      string
    Username    string
    Roles       []string          // role names for display
    Scopes      []string          // raw granted scopes (may include wildcards)
}

// HasPermission checks if the user has the given permission,
// either directly or via a wildcard scope.
func (c *SessionClaims) HasPermission(perm string) bool {
    for _, scope := range c.Scopes {
        if scope == "*" {
            return true
        }
        if scope == perm {
            return true
        }
        // Wildcard: "config:*" matches "config:read", "config:write", etc.
        if strings.HasSuffix(scope, ":*") {
            prefix := strings.TrimSuffix(scope, "*")
            if strings.HasPrefix(perm, prefix) {
                return true
            }
        }
    }
    return false
}
```

This is O(n) where n is the number of scopes for the user — typically 5-20 entries, so linear scan is faster than a map for this size. The check runs once per request from cached data (no DB hit).

**Go middleware:**

```go
func RequirePermission(perm string, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims := auth.ClaimsFromContext(r.Context())
        if claims == nil || !claims.HasPermission(perm) {
            writeError(w, r, 403, "Forbidden", "You do not have permission: "+perm)
            return
        }
        next.ServeHTTP(w, r)
    })
}

// Usage:
mux.Handle("POST /api/v1/users", RequirePermission("users:create", handler))
mux.Handle("POST /api/v1/config", RequirePermission("config:write", handler))
mux.Handle("GET /api/v1/audit", RequirePermission("audit:read", handler))
```

### Built-In Role Scope Assignments

| Role | Scopes |
|---|---|
| `superadmin` | `*` |
| `admin` | `config:*`, `keys:*`, `users:read`, `users:manage`, `roles:read`, `sessions:*`, `audit:read`, `settings:*`, `traffic:read`, `plugins:*`, `cluster:read` |
| `operator` | `config:*`, `keys:own`, `audit:read`, `settings:read`, `traffic:read`, `plugins:read`, `cluster:read` |
| `viewer` | `config:read`, `audit:read`, `settings:read`, `traffic:read`, `plugins:read`, `cluster:read` |

This means `admin` gets `config:read` + `config:write` + `config:import` + `config:export` through the single `config:*` wildcard — no need to enumerate every sub-permission.

### Custom Roles

Admins with `roles:manage` permission can:
- Create custom roles with any subset of permissions
- Assign custom roles to users (a user can have multiple roles)
- Built-in roles cannot be modified or deleted (`is_builtin = true` enforced)

**Endpoints:**

| Endpoint | Method | Permission | Purpose |
|---|---|---|---|
| `GET /api/v1/roles` | GET | `roles:read` | List all roles with their permissions |
| `POST /api/v1/roles` | POST | `roles:manage` | Create custom role |
| `GET /api/v1/roles/{id}` | GET | `roles:read` | Get role details + permissions |
| `PATCH /api/v1/roles/{id}` | PATCH | `roles:manage` | Update custom role (name, description, add/remove scopes) |
| `DELETE /api/v1/roles/{id}` | DELETE | `roles:manage` | Delete custom role (CASCADE removes assignments) |
| `GET /api/v1/permissions` | GET | `roles:read` | List all available permissions |

### Session Claims Cache

When a session is validated (cache hit or DB lookup), the resolved permission set is included:

**Cache invalidation triggers:**

- Role assignment changed (user granted/revoked a role) → evict all sessions for that user
- Role scopes changed (role's scopes modified) → evict all sessions for all users with that role
- Role deleted → CASCADE handles DB cleanup, evict affected sessions

The `SessionClaims` struct and `HasPermission` method are defined in the Hierarchical Permissions section above.

---

## Part 4: Data-at-Rest Encryption

Sensitive fields in the database are encrypted using AES-256-GCM before storage. The encryption key is derived from the daemon's signing key (already stored at `<data-dir>/signing.key`).

### Key Derivation

The signing key (32 bytes, generated during `rioku init`) is used as input to HKDF-SHA256 to derive a separate encryption key. This ensures the signing key and encryption key are cryptographically independent even though they share a root secret.

```go
// Derive encryption key from signing key
encKey := hkdf.New(sha256.New, signingKey, salt, []byte("rioku-data-encryption"))
```

- Salt: 16 bytes stored alongside the signing key (generated once during init)
- Info string: `"rioku-data-encryption"` (domain separation)
- Output: 32 bytes (AES-256 key)

### Encrypted Fields

| Table | Column | What's stored | Why encrypted |
|---|---|---|---|
| `users` | `totp_secret` | TOTP shared secret (base32) | Attacker with DB access could generate valid TOTP codes |
| `users` | `email` | User email address | PII — regulatory compliance |
| `api_keys` | `key_hash` | SHA-256 hash of API key | Already hashed, but encrypting the hash adds defense-in-depth |

### Encryption Format

Encrypted values stored as base64-encoded ciphertext with a version prefix:

```
v1:<base64(nonce + ciphertext + tag)>
```

- `v1:` prefix enables future algorithm rotation without breaking existing data
- Nonce: 12 bytes (crypto/rand), unique per encryption
- AES-256-GCM provides authenticated encryption (integrity + confidentiality)
- Total overhead: ~45 bytes per encrypted field (12 nonce + 16 tag + prefix)

### Key Rotation

When the signing key is rotated (future feature):
1. Derive new encryption key from new signing key
2. Background job re-encrypts all encrypted fields with the new key
3. Old key retained temporarily for decryption during migration
4. Version prefix (`v1:`, `v2:`) identifies which key to use for decryption

### What Is NOT Encrypted

- `password_hash`: Already a one-way argon2id hash — encryption adds no value
- `session.id`: Random UUID, no secret material
- `session.fingerprint`: SHA-256 hash, not reversible
- Config data (routes, services, policies): Not sensitive — this is operational config
- Audit log entries: Must be readable for compliance

### SQLite-Specific Considerations

SQLite does not support Transparent Data Encryption (TDE). For full database-level encryption, users can use SQLCipher (a SQLite extension). This is outside Rioku's scope — we encrypt at the application layer for the fields that matter.

Postgres and MySQL both support TDE and connection-level TLS. Rioku's application-layer encryption is defense-in-depth on top of whatever the database provides.

---

## Part 5: Session Store

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

## Part 6: Cookie Auth

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

## Part 7: Rate Limiting

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

## Part 8: Security Headers

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

## Part 9: Route Loaders (Frontend)

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

## Part 10: Event Subscription Abstraction (SSE)

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

## Part 11: Admin Panel Session Management

### Endpoints

| Endpoint | Method | Permission | Purpose |
|---|---|---|---|
| `GET /api/v1/auth/me` | GET | Any session | Current session + user info + permissions |
| `POST /api/v1/auth/logout` | POST | Any session | Delete session, clear cookie |
| `GET /api/v1/auth/sessions` | GET | `sessions:read` | List all active sessions |
| `DELETE /api/v1/auth/sessions/{id}` | DELETE | `sessions:manage` | Revoke specific session |
| `DELETE /api/v1/auth/sessions?user_id={id}` | DELETE | `sessions:manage` | Revoke all sessions for user |

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
    "roles": ["superadmin"],
    "permissions": ["config:read", "config:write", "users:create", "..."],
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
- [ ] Permission check: user with `config:write` can POST config, user without cannot (403)
- [ ] Multi-role: user with two roles gets union of permissions
- [ ] Built-in roles seeded with correct permissions
- [ ] Custom role: create role with subset of permissions → assign to user → permissions enforced
- [ ] Built-in roles cannot be modified or deleted
- [ ] Role assignment change → all sessions for user evicted from cache
- [ ] Role permission change → all sessions for users with that role evicted
- [ ] Role CRUD endpoints enforce `roles:manage` permission
- [ ] `/api/v1/permissions` lists all available permissions
- [ ] Hierarchical permissions: `config:*` grants all config sub-permissions

### Data-at-Rest Encryption
- [ ] TOTP secrets encrypted in DB (not readable as plaintext)
- [ ] Email addresses encrypted in DB
- [ ] Encryption key derived from signing key via HKDF (not the signing key itself)
- [ ] Encrypted values use versioned format (`v1:...`)
- [ ] Decryption works correctly after daemon restart

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
