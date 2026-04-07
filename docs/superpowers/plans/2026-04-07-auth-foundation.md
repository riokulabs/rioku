# Auth Foundation Implementation Plan (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the server-side auth foundation — database schema for users and sessions, store interface extensions, argon2id password hashing, server-side session management with LRU cache, HttpOnly cookie auth, rewritten auth middleware with cookie-first priority, new route handlers for login/logout/me/password, `rioku init` root user creation, session cleanup goroutine, and configurable password policy validation. No frontend changes. Bearer token auth remains fully backwards compatible.

**Architecture:** The `users` and `sessions` tables are added in migration `000002`. The `store.Tx` interface gains User and Session CRUD methods. The `internal/auth` package is extended (not replaced) with a new `SessionManager` that owns argon2id hashing, session create/validate/revoke, an LRU cache, and fingerprint computation. Auth middleware gains cookie-first logic; the Bearer path is unchanged. New route handlers in `internal/gateway/` cover login, logout, me, password change, and profile update. `rioku init` gains root user creation. A background goroutine sweeps expired sessions hourly.

**Tech Stack:** Go 1.24+, `golang.org/x/crypto/argon2`, `github.com/google/uuid`, standard library only for everything else. No external LRU library — implement a simple doubly-linked-list + map LRU in ~80 lines.

**Spec:** `contrib-docs/design/auth-security-overhaul.md` (Parts 1, 4, 5, 6)

---

## File Structure

New files:
```
packages/daemon/internal/store/migrations/sqlite/000002_auth_users_sessions.up.sql
packages/daemon/internal/store/migrations/sqlite/000002_auth_users_sessions.down.sql
packages/daemon/internal/store/migrations/postgres/000002_auth_users_sessions.up.sql
packages/daemon/internal/store/migrations/postgres/000002_auth_users_sessions.down.sql
packages/daemon/internal/store/migrations/mysql/000002_auth_users_sessions.up.sql
packages/daemon/internal/store/migrations/mysql/000002_auth_users_sessions.down.sql
packages/daemon/internal/auth/password.go         — argon2id hash/verify + policy validation
packages/daemon/internal/auth/session.go          — SessionManager, LRU cache, fingerprint
packages/daemon/internal/auth/lru.go              — generic LRU implementation
packages/daemon/internal/auth/password_test.go
packages/daemon/internal/auth/session_test.go
packages/daemon/internal/auth/lru_test.go
```

Modified files:
```
packages/daemon/internal/store/driver.go              — Tx interface additions + new store types
packages/daemon/internal/store/sqlite/sqlite.go       — implement new Tx methods
packages/daemon/internal/gateway/auth_middleware.go   — cookie-first, fingerprint validation
packages/daemon/internal/gateway/auth_routes.go       — new login/logout/me/password handlers
packages/daemon/internal/cli/init.go                  — create root user after migration
packages/daemon/internal/config/config.go             — auth.password_policy + auth.lockout config
```

---

## Task 1: Database migrations — all three dialects

**Files:**
- Create: `packages/daemon/internal/store/migrations/sqlite/000002_auth_users_sessions.up.sql`
- Create: `packages/daemon/internal/store/migrations/sqlite/000002_auth_users_sessions.down.sql`
- Create: `packages/daemon/internal/store/migrations/postgres/000002_auth_users_sessions.up.sql`
- Create: `packages/daemon/internal/store/migrations/postgres/000002_auth_users_sessions.down.sql`
- Create: `packages/daemon/internal/store/migrations/mysql/000002_auth_users_sessions.up.sql`
- Create: `packages/daemon/internal/store/migrations/mysql/000002_auth_users_sessions.down.sql`

- [ ] **Step 1: Write SQLite up migration**

  File: `packages/daemon/internal/store/migrations/sqlite/000002_auth_users_sessions.up.sql`

  ```sql
  -- 000002_auth_users_sessions.up.sql
  -- Adds user accounts and server-side session tables.

  --------------------------------------------------------------------------------
  -- Identity: users
  --------------------------------------------------------------------------------
  CREATE TABLE users (
      id                    TEXT PRIMARY KEY,
      username              TEXT NOT NULL UNIQUE,
      email                 TEXT,
      display_name          TEXT,
      password_hash         TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended', 'locked')),
      totp_secret           TEXT,
      totp_enabled          INTEGER NOT NULL DEFAULT 0,
      force_password_change INTEGER NOT NULL DEFAULT 0,
      failed_attempts       INTEGER NOT NULL DEFAULT 0,
      locked_until          TEXT,
      last_login            TEXT,
      password_changed_at   TEXT NOT NULL,
      created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE UNIQUE INDEX idx_users_username ON users (username);

  --------------------------------------------------------------------------------
  -- Identity: sessions
  --------------------------------------------------------------------------------
  CREATE TABLE sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      last_active TEXT NOT NULL,
      ip_address  TEXT,
      user_agent  TEXT
  );

  CREATE INDEX idx_sessions_user_id ON sessions (user_id);
  CREATE INDEX idx_sessions_expires ON sessions (expires_at);

  INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (2, 0);
  ```

- [ ] **Step 2: Write SQLite down migration**

  File: `packages/daemon/internal/store/migrations/sqlite/000002_auth_users_sessions.down.sql`

  ```sql
  -- 000002_auth_users_sessions.down.sql
  DROP INDEX IF EXISTS idx_sessions_expires;
  DROP INDEX IF EXISTS idx_sessions_user_id;
  DROP TABLE IF EXISTS sessions;
  DROP INDEX IF EXISTS idx_users_username;
  DROP TABLE IF EXISTS users;
  DELETE FROM schema_versions WHERE version = 2;
  ```

- [ ] **Step 3: Write Postgres up migration**

  File: `packages/daemon/internal/store/migrations/postgres/000002_auth_users_sessions.up.sql`

  ```sql
  -- 000002_auth_users_sessions.up.sql (postgres)

  CREATE TABLE users (
      id                    TEXT PRIMARY KEY,
      username              TEXT NOT NULL UNIQUE,
      email                 TEXT,
      display_name          TEXT,
      password_hash         TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended', 'locked')),
      totp_secret           TEXT,
      totp_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
      force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
      failed_attempts       INTEGER NOT NULL DEFAULT 0,
      locked_until          TIMESTAMPTZ,
      last_login            TIMESTAMPTZ,
      password_changed_at   TIMESTAMPTZ NOT NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX idx_users_username ON users (username);

  CREATE TABLE sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      last_active TIMESTAMPTZ NOT NULL,
      ip_address  TEXT,
      user_agent  TEXT
  );

  CREATE INDEX idx_sessions_user_id ON sessions (user_id);
  CREATE INDEX idx_sessions_expires ON sessions (expires_at);

  INSERT INTO schema_versions (version, dirty) VALUES (2, false)
      ON CONFLICT (version) DO NOTHING;
  ```

- [ ] **Step 4: Write Postgres down migration**

  File: `packages/daemon/internal/store/migrations/postgres/000002_auth_users_sessions.down.sql`

  ```sql
  DROP INDEX IF EXISTS idx_sessions_expires;
  DROP INDEX IF EXISTS idx_sessions_user_id;
  DROP TABLE IF EXISTS sessions;
  DROP INDEX IF EXISTS idx_users_username;
  DROP TABLE IF EXISTS users;
  DELETE FROM schema_versions WHERE version = 2;
  ```

- [ ] **Step 5: Write MySQL up migration**

  File: `packages/daemon/internal/store/migrations/mysql/000002_auth_users_sessions.up.sql`

  ```sql
  -- 000002_auth_users_sessions.up.sql (mysql)

  CREATE TABLE users (
      id                    VARCHAR(36) NOT NULL PRIMARY KEY,
      username              VARCHAR(64) NOT NULL UNIQUE,
      email                 VARCHAR(255),
      display_name          VARCHAR(255),
      password_hash         TEXT NOT NULL,
      status                ENUM('active','suspended','locked') NOT NULL DEFAULT 'active',
      totp_secret           TEXT,
      totp_enabled          TINYINT(1) NOT NULL DEFAULT 0,
      force_password_change TINYINT(1) NOT NULL DEFAULT 0,
      failed_attempts       INT NOT NULL DEFAULT 0,
      locked_until          DATETIME(3),
      last_login            DATETIME(3),
      password_changed_at   DATETIME(3) NOT NULL,
      created_at            DATETIME(3) NOT NULL DEFAULT (NOW(3)),
      updated_at            DATETIME(3) NOT NULL DEFAULT (NOW(3))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  CREATE TABLE sessions (
      id          VARCHAR(36) NOT NULL PRIMARY KEY,
      user_id     VARCHAR(36) NOT NULL,
      fingerprint VARCHAR(64) NOT NULL,
      created_at  DATETIME(3) NOT NULL,
      expires_at  DATETIME(3) NOT NULL,
      last_active DATETIME(3) NOT NULL,
      ip_address  VARCHAR(45),
      user_agent  TEXT,
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  CREATE INDEX idx_sessions_user_id ON sessions (user_id);
  CREATE INDEX idx_sessions_expires ON sessions (expires_at);

  INSERT IGNORE INTO schema_versions (version, dirty) VALUES (2, 0);
  ```

- [ ] **Step 6: Write MySQL down migration**

  File: `packages/daemon/internal/store/migrations/mysql/000002_auth_users_sessions.down.sql`

  ```sql
  DROP INDEX idx_sessions_expires ON sessions;
  DROP INDEX idx_sessions_user_id ON sessions;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS users;
  DELETE FROM schema_versions WHERE version = 2;
  ```

- [ ] **Step 7: Update the SQLite driver's migrateUp to apply migration 2**

  In `packages/daemon/internal/store/sqlite/sqlite.go`, the `migrateUp` method currently checks `current >= 1` and returns early. Extend it to also apply migration 2 when `current < 2`. Pattern:

  ```go
  func (d *driver) migrateUp(ctx context.Context) error {
      current, _ := d.CurrentVersion(ctx)
      if current < 1 {
          data, err := store.MigrationFS.ReadFile("migrations/sqlite/000001_initial.up.sql")
          if err != nil {
              return fmt.Errorf("sqlite: read migration 1: %w", err)
          }
          if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
              return fmt.Errorf("sqlite: apply migration 1: %w", err)
          }
          if _, err := d.db.ExecContext(ctx,
              `INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (1, 0)`); err != nil {
              return fmt.Errorf("sqlite: record schema version 1: %w", err)
          }
          current = 1
      }
      if current < 2 {
          data, err := store.MigrationFS.ReadFile("migrations/sqlite/000002_auth_users_sessions.up.sql")
          if err != nil {
              return fmt.Errorf("sqlite: read migration 2: %w", err)
          }
          if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
              return fmt.Errorf("sqlite: apply migration 2: %w", err)
          }
      }
      return nil
  }
  ```

  Also update `migrateDown` to roll back migration 2 before migration 1 if both are applied.

- [ ] **Step 8: Verify migrations compile and the embed picks them up**

  ```
  go build ./packages/daemon/...
  ```

  Expected: clean compile. The `go:embed migrations/*/*.sql` glob in `migrations.go` picks up all `.sql` files including the new ones.

**Commit:** `feat(store): add migration 000002 — users and sessions tables (all three dialects)`

---

## Task 2: Store interface additions + new types

**Files:**
- Modify: `packages/daemon/internal/store/driver.go`

- [ ] **Step 1: Add User and Session types to `driver.go`**

  Add after the `AuditQuery` type:

  ```go
  // User represents a daemon user account.
  type User struct {
      ID                  string
      Username            string
      Email               *string
      DisplayName         *string
      PasswordHash        string
      Status              string // "active", "suspended", "locked"
      TOTPSecret          *string
      TOTPEnabled         bool
      ForcePasswordChange bool
      FailedAttempts      int
      LockedUntil         *time.Time
      LastLogin           *time.Time
      PasswordChangedAt   time.Time
      CreatedAt           time.Time
      UpdatedAt           time.Time
  }

  // Session represents a server-side auth session.
  type Session struct {
      ID          string
      UserID      string
      Fingerprint string
      CreatedAt   time.Time
      ExpiresAt   time.Time
      LastActive  time.Time
      IPAddress   *string
      UserAgent   *string
  }
  ```

- [ ] **Step 2: Add User CRUD methods to the Tx interface**

  Add to the `Tx` interface after the `// --- Audit Log ---` block:

  ```go
  // --- Users ---

  CreateUser(ctx context.Context, u *User) (*User, error)
  GetUser(ctx context.Context, id string) (*User, error)
  GetUserByUsername(ctx context.Context, username string) (*User, error)
  ListUsers(ctx context.Context) ([]*User, error)
  UpdateUser(ctx context.Context, u *User) (*User, error)
  DeleteUser(ctx context.Context, id string) error

  // IncrementFailedAttempts increments failed_attempts and optionally sets
  // locked_until + status='locked' if threshold is reached.
  IncrementFailedAttempts(ctx context.Context, userID string, lockUntil *time.Time) error
  // ResetFailedAttempts sets failed_attempts=0 and clears locked_until on successful login.
  ResetFailedAttempts(ctx context.Context, userID string) error
  // UpdateLastLogin sets last_login to now for the given user.
  UpdateLastLogin(ctx context.Context, userID string) error

  // --- Sessions ---

  CreateSession(ctx context.Context, s *Session) (*Session, error)
  GetSession(ctx context.Context, id string) (*Session, error)
  ListSessionsByUser(ctx context.Context, userID string) ([]*Session, error)
  DeleteSession(ctx context.Context, id string) error
  DeleteSessionsByUser(ctx context.Context, userID string) error
  // DeleteSessionsByUserExcept deletes all sessions for the user except the given session ID.
  // Used when a credential change invalidates all other sessions.
  DeleteSessionsByUserExcept(ctx context.Context, userID, exceptSessionID string) error
  // UpdateSessionLastActive sets last_active to the given time for the given session.
  UpdateSessionLastActive(ctx context.Context, id string, t time.Time) error
  // DeleteExpiredSessions hard deletes sessions where expires_at < now OR
  // last_active < now-24h. Returns number of rows deleted.
  DeleteExpiredSessions(ctx context.Context) (int64, error)
  ```

- [ ] **Step 3: Build check**

  ```
  go build ./packages/daemon/...
  ```

  Expected: compile error listing all the SQLite `tx` methods not yet implemented. This is intentional — it confirms the interface is wired up and Task 3 needs to fill them in.

**Commit:** `feat(store): add User and Session types and Tx interface methods`

---

## Task 3: SQLite store implementation of new methods

**Files:**
- Modify: `packages/daemon/internal/store/sqlite/sqlite.go`
- Test: `packages/daemon/internal/store/sqlite/sqlite_test.go`

- [ ] **Step 1: Write a failing test for `CreateUser` and `GetUserByUsername`**

  In `sqlite_test.go`, add a `TestUserCRUD` table-driven test that:
  1. Opens an in-memory SQLite DB (`?mode=memory&cache=shared`)
  2. Migrates up
  3. Creates a user
  4. Fetches by ID and by username (case-insensitive: store lowercase, query lowercase)
  5. Updates email and display_name
  6. Deletes user, verifies 404-style error on subsequent get

  Run to confirm failure:
  ```
  go test -run TestUserCRUD ./packages/daemon/internal/store/sqlite/
  ```

- [ ] **Step 2: Write a failing test for `CreateSession` and `GetSession`**

  `TestSessionCRUD` in `sqlite_test.go`:
  1. Create a user first
  2. Create a session with a known fingerprint and expiry 7 days out
  3. Get by ID, verify fields match
  4. Call `UpdateSessionLastActive`, re-fetch, verify `last_active` updated
  5. `DeleteSession`, verify gone
  6. Create two sessions for same user, call `DeleteSessionsByUserExcept(userID, sess1.ID)`, verify sess2 deleted and sess1 still exists

  Run to confirm failure:
  ```
  go test -run TestSessionCRUD ./packages/daemon/internal/store/sqlite/
  ```

- [ ] **Step 3: Implement user methods on `tx` in `sqlite.go`**

  Add after the API Keys section. Key implementation notes:
  - `username` is stored lowercase (`strings.ToLower(u.Username)`)
  - `GetUserByUsername` queries `WHERE LOWER(username) = LOWER(?)` for safety
  - Nullable fields (`email`, `display_name`, `totp_secret`, `locked_until`, `last_login`) use `*string` / `*time.Time` with `sql.NullString` / `sql.NullTime` for scanning
  - Timestamps stored as ISO8601 strings with milliseconds: `2006-01-02T15:04:05.000Z` (same `timeFormat` constant already in file)
  - `totp_enabled` and `force_password_change` are stored as integers `0`/`1` (SQLite boolean)

  Required method signatures:
  ```go
  func (t *tx) CreateUser(ctx context.Context, u *store.User) (*store.User, error)
  func (t *tx) GetUser(ctx context.Context, id string) (*store.User, error)
  func (t *tx) GetUserByUsername(ctx context.Context, username string) (*store.User, error)
  func (t *tx) ListUsers(ctx context.Context) ([]*store.User, error)
  func (t *tx) UpdateUser(ctx context.Context, u *store.User) (*store.User, error)
  func (t *tx) DeleteUser(ctx context.Context, id string) error
  func (t *tx) IncrementFailedAttempts(ctx context.Context, userID string, lockUntil *time.Time) error
  func (t *tx) ResetFailedAttempts(ctx context.Context, userID string) error
  func (t *tx) UpdateLastLogin(ctx context.Context, userID string) error
  ```

  `IncrementFailedAttempts` SQL:
  ```sql
  UPDATE users
  SET failed_attempts = failed_attempts + 1,
      locked_until    = ?,          -- NULL if not locking, ISO8601 if locking
      status          = CASE WHEN ? IS NOT NULL THEN 'locked' ELSE status END,
      updated_at      = ?
  WHERE id = ?
  ```

- [ ] **Step 4: Implement session methods on `tx` in `sqlite.go`**

  ```go
  func (t *tx) CreateSession(ctx context.Context, s *store.Session) (*store.Session, error)
  func (t *tx) GetSession(ctx context.Context, id string) (*store.Session, error)
  func (t *tx) ListSessionsByUser(ctx context.Context, userID string) ([]*store.Session, error)
  func (t *tx) DeleteSession(ctx context.Context, id string) error
  func (t *tx) DeleteSessionsByUser(ctx context.Context, userID string) error
  func (t *tx) DeleteSessionsByUserExcept(ctx context.Context, userID, exceptSessionID string) error
  func (t *tx) UpdateSessionLastActive(ctx context.Context, id string, t time.Time) error
  func (t *tx) DeleteExpiredSessions(ctx context.Context) (int64, error)
  ```

  `DeleteExpiredSessions` SQL (SQLite):
  ```sql
  DELETE FROM sessions
  WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     OR last_active < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')
  ```

- [ ] **Step 5: Run tests — expect pass**

  ```
  go test -race -run 'TestUserCRUD|TestSessionCRUD' ./packages/daemon/internal/store/sqlite/
  ```

- [ ] **Step 6: Build check**

  ```
  go build ./packages/daemon/...
  ```

  Expected: clean compile (all interface methods now satisfied).

**Commit:** `feat(store/sqlite): implement User and Session CRUD methods`

---

## Task 4: Config schema additions — password policy and lockout

**Files:**
- Modify: `packages/daemon/internal/config/config.go` (or wherever the daemon config struct lives)

- [ ] **Step 1: Locate the config struct**

  Search for `type Config struct` or `type DaemonConfig struct` in `packages/daemon/internal/config/`. Read enough to understand the existing structure (specifically the `auth` field if it exists, or where to add it).

- [ ] **Step 2: Add `AuthConfig` to the config struct**

  Add or extend:

  ```go
  // PasswordPolicy defines complexity and lifetime rules for user passwords.
  type PasswordPolicy struct {
      MinLength       int  `yaml:"min_length"`        // default: 12
      RequireUppercase bool `yaml:"require_uppercase"` // default: true
      RequireLowercase bool `yaml:"require_lowercase"` // default: true
      RequireDigit    bool `yaml:"require_digit"`      // default: true
      RequireSpecial  bool `yaml:"require_special"`    // default: false
      MaxAgeDays      int  `yaml:"max_age_days"`       // 0 = never expires
      HistoryCount    int  `yaml:"history_count"`      // 0 = no history check
  }

  // LockoutPolicy defines account lockout behavior on repeated auth failures.
  type LockoutPolicy struct {
      MaxAttempts     int           `yaml:"max_attempts"`     // default: 5
      LockoutDuration time.Duration `yaml:"lockout_duration"` // default: 15m
      ResetAfter      time.Duration `yaml:"reset_after"`      // default: 30m
  }

  // AuthConfig holds all auth-related daemon configuration.
  type AuthConfig struct {
      PasswordPolicy PasswordPolicy `yaml:"password_policy"`
      Lockout        LockoutPolicy  `yaml:"lockout"`
      DevMode        bool           `yaml:"dev_mode"` // omits Secure on cookies
  }
  ```

  Add to the root Config struct:
  ```go
  Auth AuthConfig `yaml:"auth"`
  ```

- [ ] **Step 3: Populate defaults in the `Default()` function**

  ```go
  Auth: AuthConfig{
      PasswordPolicy: PasswordPolicy{
          MinLength:        12,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireDigit:     true,
          RequireSpecial:   false,
          MaxAgeDays:       0,
          HistoryCount:     0,
      },
      Lockout: LockoutPolicy{
          MaxAttempts:     5,
          LockoutDuration: 15 * time.Minute,
          ResetAfter:      30 * time.Minute,
      },
  },
  ```

- [ ] **Step 4: Build check**

  ```
  go build ./packages/daemon/...
  ```

**Commit:** `feat(config): add auth.password_policy and auth.lockout configuration`

---

## Task 5: Password hashing and policy validation

**Files:**
- Create: `packages/daemon/internal/auth/password.go`
- Create: `packages/daemon/internal/auth/password_test.go`

- [ ] **Step 1: Write failing tests for hash/verify and policy validation**

  `packages/daemon/internal/auth/password_test.go`:

  ```go
  package auth_test

  // TestArgon2idHashVerify
  // - Hash a password, verify it matches
  // - Verify different password does not match
  // - Hash same password twice, verify hashes differ (different salts)
  // - Verify the stored hash format: "$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>"

  // TestPasswordPolicyValidate (table-driven)
  // cases: empty password, too short, missing uppercase, missing lowercase,
  //        missing digit, missing special (when required), passes all rules
  ```

  Run to confirm failure:
  ```
  go test -run 'TestArgon2id|TestPasswordPolicy' ./packages/daemon/internal/auth/
  ```

- [ ] **Step 2: Implement `password.go`**

  ```go
  package auth

  import (
      "crypto/rand"
      "crypto/subtle"
      "encoding/base64"
      "errors"
      "fmt"
      "strings"
      "unicode"

      "golang.org/x/crypto/argon2"

      "github.com/riokulabs/rioku/internal/config"
  )

  // Argon2id parameters.
  const (
      argonMemory      = 64 * 1024 // 64 MB
      argonIterations  = 3
      argonParallelism = 4
      argonSaltLen     = 16
      argonKeyLen      = 32
  )

  // HashPassword hashes a password using argon2id with a random salt.
  // Returns a formatted hash string:
  //   $argon2id$v=19$m=65536,t=3,p=4$<base64-salt>$<base64-hash>
  func HashPassword(password string) (string, error)

  // VerifyPassword checks a plaintext password against a stored argon2id hash.
  // Uses constant-time comparison to prevent timing attacks.
  func VerifyPassword(password, encoded string) (bool, error)

  // ValidatePasswordPolicy checks a candidate password against the given policy.
  // Returns a descriptive error if any rule is violated, nil if the password is acceptable.
  func ValidatePasswordPolicy(password string, policy config.PasswordPolicy) error
  ```

  Implementation notes:
  - `HashPassword`: generate 16-byte salt via `crypto/rand`, call `argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLen)`, format as `$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s`
  - `VerifyPassword`: parse format string, re-derive key with same params, `subtle.ConstantTimeCompare`
  - `ValidatePasswordPolicy`: single-pass over the runes, accumulate violations, return combined error message

- [ ] **Step 3: Run tests — expect pass**

  ```
  go test -race -run 'TestArgon2id|TestPasswordPolicy' ./packages/daemon/internal/auth/
  ```

- [ ] **Step 4: Build check**

  ```
  go build ./packages/daemon/...
  ```

**Commit:** `feat(auth): argon2id password hashing and configurable policy validation`

---

## Task 6: LRU cache

**Files:**
- Create: `packages/daemon/internal/auth/lru.go`
- Create: `packages/daemon/internal/auth/lru_test.go`

- [ ] **Step 1: Write failing tests**

  `TestLRU` (table-driven):
  - Set + Get hit
  - Get miss returns zero value + false
  - Capacity eviction: add N+1 items, oldest is evicted
  - TTL expiry: set with short TTL, sleep past it, get returns miss
  - Delete removes entry
  - Len reports correct count

  ```
  go test -run TestLRU ./packages/daemon/internal/auth/
  ```

- [ ] **Step 2: Implement `lru.go`**

  Generic doubly-linked-list + map LRU. No external dependencies.

  ```go
  package auth

  import (
      "sync"
      "time"
  )

  // lruEntry holds a cached value and its expiry.
  type lruEntry[V any] struct {
      key     string
      value   V
      expires time.Time
      prev    *lruEntry[V]
      next    *lruEntry[V]
  }

  // LRU is a thread-safe LRU cache with per-entry TTL.
  type LRU[V any] struct {
      mu       sync.Mutex
      capacity int
      ttl      time.Duration
      items    map[string]*lruEntry[V]
      head     *lruEntry[V] // most recently used
      tail     *lruEntry[V] // least recently used
  }

  // NewLRU creates an LRU cache with the given capacity and entry TTL.
  func NewLRU[V any](capacity int, ttl time.Duration) *LRU[V]

  // Set inserts or replaces an entry. Evicts LRU entry when at capacity.
  func (c *LRU[V]) Set(key string, value V)

  // Get returns the value for a key and whether it was found and is not expired.
  // A found-but-expired entry is treated as a miss and removed.
  func (c *LRU[V]) Get(key string) (V, bool)

  // Delete removes an entry from the cache.
  func (c *LRU[V]) Delete(key string)

  // Len returns the number of entries currently in the cache (including expired).
  func (c *LRU[V]) Len() int
  ```

- [ ] **Step 3: Run tests — expect pass**

  ```
  go test -race -run TestLRU ./packages/daemon/internal/auth/
  ```

**Commit:** `feat(auth): generic LRU cache with per-entry TTL`

---

## Task 7: SessionManager — session lifecycle and fingerprinting

**Files:**
- Create: `packages/daemon/internal/auth/session.go`
- Create: `packages/daemon/internal/auth/session_test.go`

- [ ] **Step 1: Write failing tests**

  `packages/daemon/internal/auth/session_test.go` — use an in-memory SQLite store:

  ```go
  // TestSessionCreate
  // - Create session, verify ID is UUID, expiry is 7 days from now, last_active is ~now
  // - Fingerprint computed correctly from UA + Accept-Language

  // TestSessionValidate
  // - Create session, validate it (cache miss → DB hit, populates cache)
  // - Validate again (cache hit, no DB call needed — mock or verify via timing)
  // - Validate with wrong fingerprint → error "fingerprint mismatch"
  // - Validate after absolute expiry → error "session expired"
  // - Validate after sliding window (last_active > 24h ago) → error "session inactive"

  // TestSessionRevoke
  // - Create two sessions for same user
  // - Revoke one by ID, verify only that session is gone
  // - RevokeAllExcept, verify correct session remains

  // TestLastActiveDebounce
  // - Validate session twice within 60s, verify UpdateSessionLastActive called once
  ```

  ```
  go test -run 'TestSession|TestLastActive' ./packages/daemon/internal/auth/
  ```

- [ ] **Step 2: Implement `session.go`**

  ```go
  package auth

  import (
      "context"
      "crypto/sha256"
      "fmt"
      "net/http"
      "sync"
      "time"

      "github.com/google/uuid"
      "github.com/riokulabs/rioku/internal/store"
  )

  const (
      SessionCookieName  = "rioku_sid"
      SessionAbsoluteTTL = 7 * 24 * time.Hour
      SessionSlidingTTL  = 24 * time.Hour
      sessionCacheSize   = 10_000
      sessionCacheTTL    = 60 * time.Second
      debounceWindow     = time.Minute
  )

  // SessionClaims is injected into the request context on successful session validation.
  // It is separate from the existing JWT Claims type.
  type SessionClaims struct {
      SessionID string
      UserID    string
      Username  string
      // Roles and Scopes are populated from the DB at session creation / cache miss.
      // Plan 2 (RBAC) fills these in; for now they are empty slices.
      Roles  []string
      Scopes []string
  }

  // HasPermission checks if the user has the given permission,
  // either directly or via a wildcard scope.
  func (c *SessionClaims) HasPermission(perm string) bool

  // sessionCacheEntry is what we store in the LRU.
  type sessionCacheEntry struct {
      session *store.Session
      claims  *SessionClaims
      // lastActiveUpdatedAt tracks when we last debounced the DB update.
      lastActiveUpdatedAt time.Time
  }

  // SessionManager manages the full session lifecycle.
  type SessionManager struct {
      store   store.Driver
      cache   *LRU[*sessionCacheEntry]
      devMode bool

      // debounce map tracks pending last_active updates (session ID → last update time)
      debounceMu sync.Mutex
      debounce   map[string]time.Time
  }

  // NewSessionManager creates a SessionManager with a 10K-capacity, 60s-TTL LRU cache.
  func NewSessionManager(st store.Driver, devMode bool) *SessionManager

  // ComputeFingerprint returns SHA-256(userAgent + acceptLanguage) as a hex string.
  func ComputeFingerprint(userAgent, acceptLanguage string) string

  // CreateSession creates a new session for the given user.
  // Returns the session (caller sets the cookie).
  func (sm *SessionManager) CreateSession(ctx context.Context, userID string, r *http.Request) (*store.Session, error)

  // ValidateSession looks up a session by ID, validates it, and returns claims.
  // Validation order: LRU cache → DB → check expiry → check fingerprint.
  // Updates last_active (debounced, once per minute).
  func (sm *SessionManager) ValidateSession(ctx context.Context, sessionID string, r *http.Request) (*SessionClaims, error)

  // RevokeSession hard deletes a session and evicts it from the LRU cache.
  func (sm *SessionManager) RevokeSession(ctx context.Context, sessionID string) error

  // RevokeAllSessionsForUser hard deletes all sessions for a user and evicts from cache.
  func (sm *SessionManager) RevokeAllSessionsForUser(ctx context.Context, userID string) error

  // RevokeOtherSessions revokes all sessions for the user except the given session ID.
  func (sm *SessionManager) RevokeOtherSessions(ctx context.Context, userID, exceptSessionID string) error

  // SetCookie writes the rioku_sid cookie to the response.
  // Omits Secure flag when devMode is true.
  func (sm *SessionManager) SetCookie(w http.ResponseWriter, sessionID string)

  // ClearCookie clears the rioku_sid cookie.
  func (sm *SessionManager) ClearCookie(w http.ResponseWriter)

  // CleanupExpired deletes expired/inactive sessions from the DB.
  // Intended to be called from a background goroutine.
  func (sm *SessionManager) CleanupExpired(ctx context.Context) (int64, error)
  ```

  Cookie format (written by `SetCookie`):
  ```go
  http.SetCookie(w, &http.Cookie{
      Name:     SessionCookieName,
      Value:    sessionID,
      HttpOnly: true,
      Secure:   !sm.devMode,
      SameSite: http.SameSiteStrictMode,
      Path:     "/",
      MaxAge:   86400,
  })
  ```

  `ComputeFingerprint` implementation:
  ```go
  func ComputeFingerprint(userAgent, acceptLanguage string) string {
      h := sha256.Sum256([]byte(userAgent + acceptLanguage))
      return hex.EncodeToString(h[:])
  }
  ```

  `ValidateSession` logic:
  1. Check LRU cache — if hit and not expired: verify fingerprint against computed fingerprint from current request headers, update debounce, return claims
  2. On cache miss: open read-only tx, `GetSession(ctx, sessionID)`, verify absolute expiry (`expires_at`), verify sliding expiry (`last_active + 24h`), verify fingerprint
  3. Load user from DB (needed for username, status check)
  4. If user status is `suspended` or `locked`: return error
  5. Populate `SessionClaims` (Roles/Scopes empty until Plan 2)
  6. Store in LRU cache
  7. Debounce `UpdateSessionLastActive`: only call if last update was >1 minute ago

- [ ] **Step 3: Run tests — expect pass**

  ```
  go test -race -run 'TestSession|TestLastActive' ./packages/daemon/internal/auth/
  ```

- [ ] **Step 4: Build check**

  ```
  go build ./packages/daemon/...
  ```

**Commit:** `feat(auth): session manager with LRU cache, fingerprinting, and cookie helpers`

---

## Task 8: Session cleanup background goroutine

**Files:**
- Modify: `packages/daemon/internal/auth/session.go` (add `StartCleanupWorker`)
- Test: `packages/daemon/internal/auth/session_test.go`

- [ ] **Step 1: Write failing test**

  `TestCleanupWorker`:
  - Create two sessions: one with `expires_at = now - 1s`, one valid
  - Call `CleanupExpired` directly (not the goroutine), verify exactly 1 row deleted
  - Verify the valid session is still present

  ```
  go test -run TestCleanupWorker ./packages/daemon/internal/auth/
  ```

- [ ] **Step 2: Implement `StartCleanupWorker` in `session.go`**

  ```go
  // StartCleanupWorker starts a background goroutine that calls CleanupExpired every hour.
  // Cancel the context to stop it.
  func (sm *SessionManager) StartCleanupWorker(ctx context.Context) {
      go func() {
          ticker := time.NewTicker(time.Hour)
          defer ticker.Stop()
          for {
              select {
              case <-ctx.Done():
                  return
              case <-ticker.C:
                  n, err := sm.CleanupExpired(ctx)
                  if err != nil {
                      // log, don't panic — cleanup failure is non-fatal
                      _ = err
                  }
                  _ = n
              }
          }
      }()
  }
  ```

  The daemon start command calls `sm.StartCleanupWorker(ctx)` after constructing the `SessionManager`. This is wired in Task 11.

- [ ] **Step 3: Run tests — expect pass**

  ```
  go test -race -run TestCleanupWorker ./packages/daemon/internal/auth/
  ```

**Commit:** `feat(auth): session cleanup background goroutine`

---

## Task 9: Auth middleware rewrite — cookie-first, fingerprint validation

**Files:**
- Modify: `packages/daemon/internal/gateway/auth_middleware.go`

- [ ] **Step 1: Add `rioku_sid` login path to `skipAuthPaths`**

  The new login endpoint must be public. Add to `skipAuthPaths`:
  ```go
  "/api/v1/auth/login": true,
  ```

- [ ] **Step 2: Update `AuthMiddleware` signature to accept `*auth.SessionManager`**

  Current signature:
  ```go
  func AuthMiddleware(a *auth.Auth) func(http.Handler) http.Handler
  ```

  New signature (both args; Bearer auth still uses `*auth.Auth`):
  ```go
  func AuthMiddleware(a *auth.Auth, sm *auth.SessionManager) func(http.Handler) http.Handler
  ```

- [ ] **Step 3: Implement cookie-first priority logic**

  ```go
  func AuthMiddleware(a *auth.Auth, sm *auth.SessionManager) func(http.Handler) http.Handler {
      return func(next http.Handler) http.Handler {
          return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
              if !strings.HasPrefix(r.URL.Path, "/api/") || skipAuthPaths[r.URL.Path] {
                  next.ServeHTTP(w, r)
                  return
              }

              // Priority 1: rioku_sid cookie (web UI / session-based auth).
              if cookie, err := r.Cookie(auth.SessionCookieName); err == nil {
                  claims, err := sm.ValidateSession(r.Context(), cookie.Value, r)
                  if err != nil {
                      // Fingerprint mismatch or expired — clear the cookie.
                      sm.ClearCookie(w)
                      writeAuthError(w, r, "Session invalid or expired")
                      return
                  }
                  // Convert SessionClaims to the legacy Claims type for downstream compatibility.
                  legacyClaims := sessionClaimsToLegacy(claims)
                  ctx := auth.WithClaims(r.Context(), legacyClaims)
                  // Also stash SessionClaims for handlers that need session-specific info.
                  ctx = auth.WithSessionClaims(ctx, claims)
                  next.ServeHTTP(w, r.WithContext(ctx))
                  return
              }

              // Priority 2: Authorization: Bearer <token> (CLI, API keys).
              header := r.Header.Get("Authorization")
              if header == "" {
                  writeAuthError(w, r, "Missing Authorization header or session cookie")
                  return
              }
              token := header
              if strings.HasPrefix(strings.ToLower(header), "bearer ") {
                  token = header[7:]
              }
              claims, err := a.ValidateBearer(r.Context(), token)
              if err != nil {
                  writeAuthError(w, r, "Invalid or expired token")
                  return
              }
              ctx := auth.WithClaims(r.Context(), claims)
              next.ServeHTTP(w, r.WithContext(ctx))
          })
      }
  }
  ```

  Add helper in `jwt.go` (or `session.go`) to convert `SessionClaims` → `Claims` and add a `WithSessionClaims`/`SessionClaimsFromContext` pair (analogous to existing `WithClaims`/`ClaimsFromContext`):

  ```go
  // sessionClaimsKey is the context key for SessionClaims.
  type sessionClaimsKey struct{}

  func WithSessionClaims(ctx context.Context, c *SessionClaims) context.Context {
      return context.WithValue(ctx, sessionClaimsKey{}, c)
  }

  func SessionClaimsFromContext(ctx context.Context) *SessionClaims {
      c, _ := ctx.Value(sessionClaimsKey{}).(*SessionClaims)
      return c
  }
  ```

  `sessionClaimsToLegacy` (private function in `auth_middleware.go`):
  ```go
  func sessionClaimsToLegacy(sc *auth.SessionClaims) *auth.Claims {
      return &auth.Claims{
          Subject:   sc.UserID,
          Roles:     sc.Roles,
          TokenType: auth.TokenTypeAccess,
      }
  }
  ```

- [ ] **Step 4: Find all call sites that construct `AuthMiddleware` and update them**

  Search for `AuthMiddleware(` in `packages/daemon/`. Update each call site to pass both `a` and `sm`.

- [ ] **Step 5: Build check**

  ```
  go build ./packages/daemon/...
  ```

**Commit:** `feat(gateway): auth middleware — cookie-first with Bearer fallback`

---

## Task 10: Auth route handlers — login, logout, me, password, profile

**Files:**
- Modify: `packages/daemon/internal/gateway/auth_routes.go`

The existing file has `RegisterAuthRoutes`, `handleTokenExchange`, and `handleTokenRefresh`. Extend it with the new handlers without touching the existing token exchange handlers (backwards compat).

- [ ] **Step 1: Update `RegisterAuthRoutes` to accept `SessionManager` and register new paths**

  ```go
  func RegisterAuthRoutes(mux *http.ServeMux, a *auth.Auth, sm *auth.SessionManager, st store.Driver, cfg *config.Config) {
      // Existing token exchange endpoints (unchanged).
      mux.HandleFunc("POST /api/v1/auth/token", handleTokenExchange(a))
      mux.HandleFunc("POST /api/v1/auth/refresh", handleTokenRefresh(a))

      // New session-based endpoints.
      mux.HandleFunc("POST /api/v1/auth/login",    handleLogin(a, sm, st, cfg))
      mux.HandleFunc("POST /api/v1/auth/logout",   handleLogout(sm))
      mux.HandleFunc("GET /api/v1/auth/me",        handleMe(st))
      mux.HandleFunc("POST /api/v1/auth/password", handlePasswordChange(sm, st, cfg))
      mux.HandleFunc("PATCH /api/v1/auth/me",      handleUpdateProfile(sm, st))
  }
  ```

- [ ] **Step 2: Implement `handleLogin`**

  Request body:
  ```go
  type loginRequest struct {
      Username string `json:"username"`
      Password string `json:"password"`
  }
  ```

  Logic (matches spec Part 1 "Login Flow", steps 1–12, TOTP excluded — that is Plan 3):
  1. Decode + validate request body
  2. Begin read-write tx, `GetUserByUsername` (case-insensitive)
  3. If not found: return `401` — "Invalid username or password" (don't reveal which)
  4. Check `status == "locked"`: if `locked_until != nil && locked_until.After(now)` → return `423` with `Retry-After` header (seconds until unlock)
  5. Check `status == "suspended"` → return `403`
  6. `auth.VerifyPassword(req.Password, user.PasswordHash)` — if false: call `IncrementFailedAttempts` (compute `lockUntil` if `failedAttempts+1 >= cfg.Auth.Lockout.MaxAttempts`), return `401`
  7. `ResetFailedAttempts`
  8. `sm.CreateSession(ctx, user.ID, r)` → get session
  9. `sm.SetCookie(w, session.ID)`
  10. `UpdateLastLogin(ctx, user.ID)`
  11. Commit tx
  12. Return `200` with response body:
      ```go
      type loginResponse struct {
          User    loginUserInfo    `json:"user"`
          Session loginSessionInfo `json:"session"`
      }
      type loginUserInfo struct {
          ID                  string `json:"id"`
          Username            string `json:"username"`
          DisplayName         string `json:"display_name,omitempty"`
          ForcePasswordChange bool   `json:"force_password_change"`
      }
      type loginSessionInfo struct {
          ID        string    `json:"id"`
          ExpiresAt time.Time `json:"expires_at"`
      }
      ```

- [ ] **Step 3: Implement `handleLogout`**

  - Read `rioku_sid` cookie — if missing return `200` (idempotent)
  - `sm.RevokeSession(ctx, cookie.Value)`
  - `sm.ClearCookie(w)`
  - Return `200 {"ok": true}`

- [ ] **Step 4: Implement `handleMe`**

  - Get `SessionClaims` from context (set by middleware for cookie auth)
  - If nil (Bearer auth path): use legacy `Claims.Subject` to identify user
  - Load user from DB by ID
  - Return user info (id, username, display_name, email, force_password_change, totp_enabled) + session info if present

- [ ] **Step 5: Implement `handlePasswordChange`**

  Request body:
  ```go
  type passwordChangeRequest struct {
      CurrentPassword string `json:"current_password"`
      NewPassword     string `json:"new_password"`
  }
  ```

  Logic:
  1. Extract user ID from context claims
  2. Load user from DB
  3. `VerifyPassword(req.CurrentPassword, user.PasswordHash)` → `401` if mismatch
  4. `ValidatePasswordPolicy(req.NewPassword, cfg.Auth.PasswordPolicy)` → `400` with message if fails
  5. `HashPassword(req.NewPassword)` → update `user.PasswordHash` + `user.PasswordChangedAt` + `user.ForcePasswordChange = false`
  6. `UpdateUser(ctx, user)`
  7. `sm.RevokeOtherSessions(ctx, user.ID, currentSessionID)` — revoke all other sessions
  8. Return `200 {"ok": true}`

- [ ] **Step 6: Implement `handleUpdateProfile`**

  Request body (all fields optional):
  ```go
  type updateProfileRequest struct {
      DisplayName *string `json:"display_name"`
      Email       *string `json:"email"`
  }
  ```

  Logic: load user, apply non-nil fields, `UpdateUser`, return updated user info. If email changed, call `sm.RevokeOtherSessions`.

- [ ] **Step 7: Update `RegisterAuthRoutes` call site in gateway setup**

  Find where `RegisterAuthRoutes` is called in `packages/daemon/internal/gateway/` and update to pass the new args.

- [ ] **Step 8: Build check**

  ```
  go build ./packages/daemon/...
  ```

- [ ] **Step 9: Smoke test via curl (against sandbox)**

  ```bash
  # Login
  curl -c /tmp/cookies.txt -X POST http://localhost:7778/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"root","password":"<generated-password>"}'
  # Expected: 200 with user + session, Set-Cookie: rioku_sid=...

  # Me (with cookie)
  curl -b /tmp/cookies.txt http://localhost:7778/api/v1/auth/me
  # Expected: 200 with user info

  # Logout
  curl -b /tmp/cookies.txt -c /tmp/cookies.txt -X POST http://localhost:7778/api/v1/auth/logout
  # Expected: 200, cookie cleared

  # Me after logout (should fail)
  curl -b /tmp/cookies.txt http://localhost:7778/api/v1/auth/me
  # Expected: 401
  ```

**Commit:** `feat(gateway): login, logout, me, password change, and profile update handlers`

---

## Task 11: `rioku init` — create root user

**Files:**
- Modify: `packages/daemon/internal/cli/init.go`

- [ ] **Step 1: Add `createRootUser` helper function**

  ```go
  // createRootUser creates the root account with a random password.
  // Returns the plaintext password (printed once, never stored).
  func createRootUser(ctx context.Context, drv store.Driver) (string, error) {
      const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
      const pwLen = 24

      // Generate cryptographically random 24-character password.
      buf := make([]byte, pwLen)
      for i := range buf {
          b := make([]byte, 1)
          for {
              if _, err := rand.Read(b); err != nil {
                  return "", fmt.Errorf("generate root password: %w", err)
              }
              if int(b[0]) < len(charset)*(256/len(charset)) {
                  buf[i] = charset[int(b[0])%len(charset)]
                  break
              }
          }
      }
      plaintext := string(buf)

      hash, err := auth.HashPassword(plaintext)
      if err != nil {
          return "", fmt.Errorf("hash root password: %w", err)
      }

      tx, err := drv.Begin(ctx, store.TxOptions{})
      if err != nil {
          return "", err
      }

      now := time.Now().UTC()
      _, err = tx.CreateUser(ctx, &store.User{
          Username:            "root",
          PasswordHash:        hash,
          Status:              "active",
          ForcePasswordChange: true,
          PasswordChangedAt:   now,
          CreatedAt:           now,
          UpdatedAt:           now,
      })
      if err != nil {
          tx.Rollback()
          return "", fmt.Errorf("create root user: %w", err)
      }
      return plaintext, tx.Commit()
  }
  ```

  Note: Role assignment (superadmin) is Plan 2. For now, root is created without a role. The RBAC seed migration in Plan 2 will assign the superadmin role to the root user.

- [ ] **Step 2: Call `createRootUser` in `runInit` after migration, before `drv.Close()`**

  After the `fmt.Printf("  Store initialized (%s)\n", ...)` line:

  ```go
  // Create root user.
  rootPassword, err := createRootUser(ctx, drv)
  if err != nil {
      drv.Close()
      return fmt.Errorf("create root user: %w", err)
  }
  ```

- [ ] **Step 3: Update the final print block to include root credentials**

  Replace the current bootstrap token print with:

  ```go
  fmt.Printf("\n  Bootstrap token: %s\n", token)
  fmt.Println("  Save this — it will not be shown again.")
  fmt.Println()
  fmt.Println("  Root account created:")
  fmt.Printf("    Username: root\n")
  fmt.Printf("    Password: %s\n", rootPassword)
  fmt.Println()
  fmt.Println("  Save this — it will not be shown again.")
  fmt.Println("  You will be required to change this password on first login.")
  fmt.Println()
  fmt.Println("Run 'rku start' to launch the daemon.")
  ```

- [ ] **Step 4: Wire `SessionManager` into the daemon start command**

  Locate `packages/daemon/internal/cli/start.go` (or wherever the gateway is constructed). After constructing `*auth.Auth`, construct `*auth.SessionManager` and pass it to `AuthMiddleware` and `RegisterAuthRoutes`. Also call `sm.StartCleanupWorker(ctx)`.

  ```go
  sm := auth.NewSessionManager(drv, cfg.Auth.DevMode)
  sm.StartCleanupWorker(ctx)
  ```

- [ ] **Step 5: Build check**

  ```
  go build ./packages/daemon/...
  ```

- [ ] **Step 6: Integration test**

  ```bash
  # Start fresh (delete existing DB)
  rm -f /tmp/rioku-test.db
  bin/rioku init --store sqlite --data-dir /tmp/rioku-test --non-interactive
  # Expected output includes:
  #   Root account created:
  #     Username: root
  #     Password: <24 chars>
  ```

**Commit:** `feat(cli): create root user with random password during rioku init`

---

## Task 12: Full integration test

**Files:**
- Test: `packages/daemon/internal/gateway/auth_integration_test.go` (new)

- [ ] **Step 1: Write integration test covering the full login flow**

  `TestAuthIntegration` (one test, sequential subtests):
  1. `rioku init` equivalent — open in-memory SQLite, migrate, create root user
  2. Start an `httptest.Server` with the full middleware + routes wired
  3. POST `/api/v1/auth/login` with root credentials → `200`, cookie set
  4. GET `/api/v1/auth/me` with cookie → `200`, verify username == "root", `force_password_change == true`
  5. POST `/api/v1/auth/login` with wrong password → `401`
  6. POST `/api/v1/auth/login` 5× with wrong password → 5th attempt returns `423 Locked` with `Retry-After`
  7. POST `/api/v1/auth/password` with old + new password → `200`, other sessions revoked
  8. POST `/api/v1/auth/logout` → `200`, cookie cleared, subsequent GET `/api/v1/auth/me` → `401`
  9. Bearer auth still works: POST `/api/v1/auth/token` with bootstrap token → `200` with `access_token`, GET `/api/v1/auth/me` with Bearer → `200`

  ```
  go test -race -run TestAuthIntegration ./packages/daemon/internal/gateway/
  ```

- [ ] **Step 2: Fix any failures**

- [ ] **Step 3: Full test suite**

  ```
  go test -race ./packages/daemon/...
  ```

- [ ] **Step 4: Sandbox smoke test**

  ```bash
  make sandbox
  # In another terminal:
  make sandbox-test-smoke
  ```

**Commit:** `test(gateway): auth integration test covering full login/logout/me/password flow`

---

## Summary

After all 12 tasks are complete:

- `000002` migration exists for all three dialects (SQLite, Postgres, MySQL) and applies cleanly on top of `000001`
- `store.Tx` has full User + Session CRUD
- `internal/auth` has argon2id password hashing, policy validation, LRU cache, and `SessionManager`
- Auth middleware checks the `rioku_sid` cookie first, falls back to Bearer — downstream handlers are auth-method-agnostic
- Login, logout, me, password change, and profile update endpoints exist and work
- `rioku init` prints a random root password; the account has `force_password_change=true`
- Session cleanup runs hourly in the background
- Bearer token auth is fully backwards compatible — no existing CLI workflows are broken
- All new code has unit tests and runs clean under `-race`
