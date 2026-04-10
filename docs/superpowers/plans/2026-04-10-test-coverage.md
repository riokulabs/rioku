# Test Coverage Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Raise Go backend test coverage from 45.2% to 80%+ by filling critical gaps identified in the test audit.

**Architecture:** Each task targets one package/file, writes focused tests for uncovered functions, verifies coverage improvement. Tests use real dependencies (SQLite stores, real HTTP servers) — no mocks except where the dependency is a child process (Caddy) or external service.

**Tech Stack:** Go 1.24+, stdlib testing, `t.TempDir()` for isolation, `-race` on all tests.

**Baseline:** `go test -coverprofile=coverage.out ./... → total: 45.2%`

---

## Priority Order

Ranked by: (uncovered lines × criticality). Security-critical code first.

| Priority | Package/File | Current | Target | Uncovered functions |
|----------|-------------|---------|--------|-------------------|
| 1 | `auth/jwt.go` | 5% | 85% | 19 functions: sign, verify, IssueTokenPair, RefreshTokens, ValidateBearer, etc. |
| 2 | `gateway/user_routes.go` | 0% | 75% | 11 handlers: CRUD, role management, password change |
| 3 | `gateway/totp_routes.go` | 0% | 75% | 6 handlers: setup, verify, remove, backup codes |
| 4 | `gateway/key_routes.go` | 0% | 75% | 5 handlers: create, list, revoke API keys |
| 5 | `gateway/auth_routes.go` | 0% | 75% | 6 handlers: login, logout, me, refresh, bootstrap token |
| 6 | `sync/agent.go` | 0% | 80% | 6 functions: Start, Stop, run, syncOnce, debounce |
| 7 | `grpc/config_service.go` | 0% | 80% | 7 RPCs: ApplyChange, GetConfig, WatchChanges |
| 8 | `grpc/health_service.go` | 0% | 80% | 2 RPCs: GetHealth, WatchHealth |
| 9 | `daemon/daemon.go` | 0% | 60% | Start, Stop, Health, openStore |
| 10 | `caddy/manager.go` | 0% | 60% | Start, Stop, PushConfig, IsRunning, Health |
| 11 | `config/file.go` | 43% | 75% | Load, Validate edge cases, defaults |
| 12 | `gateway/errors.go` + middleware | 33% | 70% | Error formatting, CORS, security headers |

---

## File Structure

### New test files to create

```
packages/daemon/internal/auth/jwt_test.go                    -- JWT unit tests
packages/daemon/internal/gateway/user_routes_test.go          -- User handler tests
packages/daemon/internal/gateway/totp_routes_test.go          -- TOTP handler tests
packages/daemon/internal/gateway/key_routes_test.go           -- API key handler tests
packages/daemon/internal/gateway/auth_routes_test.go          -- Auth handler tests
packages/daemon/internal/sync/agent_test.go                   -- Sync agent tests
packages/daemon/internal/grpc/config_service_test.go          -- ConfigService RPC tests
packages/daemon/internal/grpc/health_service_test.go          -- HealthService RPC tests
packages/daemon/internal/caddy/manager_test.go                -- Caddy manager tests
packages/daemon/internal/config/file_test.go                  -- Config load/validate tests
packages/daemon/internal/gateway/middleware_test.go            -- Error, CORS, security header tests
```

### Existing test files to modify

```
packages/daemon/internal/gateway/security_test.go             -- Fix timing attack test
packages/daemon/internal/gateway/failure_test.go              -- Fix documented panic test
```

---

## Task 1: JWT Unit Tests (auth/jwt.go — highest priority)

**Files:**
- Create: `packages/daemon/internal/auth/jwt_test.go`

Security-critical code. 435 lines, 19 functions, 5% coverage.

- [x] **Step 1: Write JWT tests**

Create `jwt_test.go` in `package auth_test` (external, black-box). Tests needed:

**Token lifecycle:**
- `TestJWT_IssueTokenPair` — issue tokens for a valid user, verify both access and refresh tokens are non-empty, verify access token contains expected claims (user_id, roles)
- `TestJWT_IssueTokenPair_EmptyKey` — nil/empty signing key should error
- `TestJWT_ValidateAccessToken` — issue a token, validate it, verify claims match
- `TestJWT_ValidateAccessToken_Expired` — issue token with past expiry, validate should fail
- `TestJWT_ValidateAccessToken_Malformed` — garbage string, empty string, truncated token
- `TestJWT_ValidateAccessToken_WrongKey` — sign with key A, validate with key B
- `TestJWT_RefreshTokens` — issue pair, use refresh token to get new pair, verify new access token works
- `TestJWT_RefreshTokens_Expired` — expired refresh token should fail
- `TestJWT_RefreshTokens_Replay` — use same refresh token twice, second use should fail (consumed)

**API key auth:**
- `TestJWT_ValidateAPIKey` — create API key in store, validate by raw key, verify scopes
- `TestJWT_ValidateAPIKey_Revoked` — revoke key, validation should fail
- `TestJWT_ValidateAPIKey_WrongKey` — non-existent key hash should fail

**Bootstrap token:**
- `TestJWT_ExchangeBootstrapToken` — create bootstrap key, exchange for bearer token
- `TestJWT_ExchangeBootstrapToken_Invalid` — wrong token should fail

**Bearer validation:**
- `TestJWT_ValidateBearer_JWT` — Bearer with JWT format routes to JWT validation
- `TestJWT_ValidateBearer_APIKey` — Bearer with API key format routes to API key validation
- `TestJWT_ValidateBearer_Empty` — empty bearer should fail

**Key rotation:**
- `TestJWT_RotateSigningKey` — rotate key, old tokens still work (backwards compat check or expected failure)

Each test creates a real SQLite store in `t.TempDir()` with a seeded user and API key. Use `auth.NewAuth(signingKey, store)` directly.

- [x] **Step 2: Run tests to verify they pass**

Run: `cd packages/daemon && go test -v -count=1 -race ./internal/auth/ -run TestJWT`
Expected: All PASS.

- [x] **Step 3: Verify coverage improvement**

Run: `go test -coverprofile=/tmp/jwt.out ./internal/auth/ && go tool cover -func=/tmp/jwt.out | grep jwt.go`
Target: jwt.go functions should show 80%+ coverage.

- [x] **Step 4: Commit**

```bash
git commit -m "test(auth): comprehensive JWT unit tests — token lifecycle, API keys, rotation"
```

---

## Task 2: Gateway User Route Tests (gateway/user_routes.go)

**Files:**
- Create: `packages/daemon/internal/gateway/user_routes_test.go`

562 lines, 11 handlers, 0% coverage. Tests user CRUD, role management, password changes.

- [x] **Step 1: Write user route tests**

Create `user_routes_test.go` in `package gateway`. Follow the existing `auth_integration_test.go` pattern — it creates a real gateway with SQLite store and makes HTTP requests.

Tests needed:
- `TestUserRoutes_ListUsers` — create 3 users, GET /api/v1/users, verify JSON array with 3 entries
- `TestUserRoutes_CreateUser` — POST with valid user data, verify 201, verify user exists in store
- `TestUserRoutes_CreateUser_InvalidPassword` — password fails policy, verify 400
- `TestUserRoutes_CreateUser_DuplicateUsername` — same username twice, verify 409
- `TestUserRoutes_GetUser` — create user, GET by ID, verify fields match
- `TestUserRoutes_GetUser_NotFound` — non-existent ID, verify 404
- `TestUserRoutes_UpdateUser` — update username, verify 200 and change persisted
- `TestUserRoutes_DeleteUser` — create user, DELETE, verify 204, verify GET returns 404
- `TestUserRoutes_UpdateRoles` — set user roles, verify persisted
- `TestUserRoutes_ChangePassword` — change password with valid old password, verify new password works
- `TestUserRoutes_ChangePassword_WrongOld` — wrong current password, verify 400

Each test needs an authenticated session (admin role). Use the existing test helper pattern from `auth_integration_test.go`.

- [x] **Step 2: Run tests, verify coverage**

Run: `go test -v -count=1 -race ./internal/gateway/ -run TestUserRoutes`
Target: user_routes.go at 70%+.

- [x] **Step 3: Commit**

```bash
git commit -m "test(gateway): user route handler tests — CRUD, roles, password changes"
```

---

## Task 3: Gateway TOTP Route Tests (gateway/totp_routes.go)

**Files:**
- Create: `packages/daemon/internal/gateway/totp_routes_test.go`

364 lines, 6 handlers, 0% coverage.

- [x] **Step 1: Write TOTP route tests**

Tests needed:
- `TestTOTPRoutes_Setup` — POST /api/v1/auth/totp/setup, verify returns QR URI and backup codes
- `TestTOTPRoutes_Verify` — setup TOTP, generate valid code, POST /api/v1/auth/totp/verify, verify success
- `TestTOTPRoutes_Verify_WrongCode` — wrong TOTP code, verify 400
- `TestTOTPRoutes_Remove` — setup + verify, then POST /api/v1/auth/totp/remove with valid code, verify removed
- `TestTOTPRoutes_Remove_NotSetup` — remove without setup, verify 400
- `TestTOTPRoutes_LoginWithTOTP` — setup + verify TOTP, login should require TOTP code
- `TestTOTPRoutes_BackupCode` — use a backup code instead of TOTP code, verify works and is consumed

Use `auth.ComputeTOTPCode()` from the existing auth package to generate valid codes in tests.

- [x] **Step 2: Run tests, verify coverage**

Target: totp_routes.go at 70%+.

- [x] **Step 3: Commit**

```bash
git commit -m "test(gateway): TOTP route handler tests — setup, verify, remove, backup codes"
```

---

## Task 4: Gateway API Key Route Tests (gateway/key_routes.go)

**Files:**
- Create: `packages/daemon/internal/gateway/key_routes_test.go`

214 lines, 5 handlers, 0% coverage.

- [x] **Step 1: Write API key route tests**

Tests needed:
- `TestKeyRoutes_CreateKey` — POST /api/v1/keys, verify returns key ID and raw key
- `TestKeyRoutes_CreateKey_InvalidScopes` — invalid scope, verify 400
- `TestKeyRoutes_ListKeys` — create 3 keys, GET /api/v1/keys, verify 3 entries (raw key NOT returned in list)
- `TestKeyRoutes_RevokeKey` — create key, DELETE /api/v1/keys/{id}, verify 204
- `TestKeyRoutes_RevokeKey_NotFound` — non-existent ID, verify 404
- `TestKeyRoutes_AuthWithKey` — create key, use raw key as Bearer token, verify access works

- [x] **Step 2: Run tests, verify coverage**

Target: key_routes.go at 75%+.

- [x] **Step 3: Commit**

```bash
git commit -m "test(gateway): API key route handler tests — create, list, revoke, auth"
```

---

## Task 5: Gateway Auth Route Tests (gateway/auth_routes.go)

**Files:**
- Create: `packages/daemon/internal/gateway/auth_routes_test.go`

933 lines, 6 handlers, 0% coverage. Note: some paths are already tested by `auth_integration_test.go` and `rbac_integration_test.go`. Focus on gaps.

- [x] **Step 1: Write auth route tests**

Tests needed:
- `TestAuthRoutes_Login_Success` — valid credentials, verify 200, verify cookies set
- `TestAuthRoutes_Login_WrongPassword` — wrong password, verify 401
- `TestAuthRoutes_Login_NonexistentUser` — unknown username, verify 401
- `TestAuthRoutes_Login_LockedAccount` — lock account, attempt login, verify 423
- `TestAuthRoutes_Me` — login, GET /api/v1/auth/me, verify user info returned
- `TestAuthRoutes_Logout` — login, POST /api/v1/auth/logout, verify cookies cleared
- `TestAuthRoutes_Refresh` — login, POST /api/v1/auth/refresh with refresh token, verify new tokens
- `TestAuthRoutes_Refresh_Invalid` — invalid refresh token, verify 401
- `TestAuthRoutes_BootstrapToken` — exchange bootstrap token for bearer, verify works
- `TestAuthRoutes_ListSessions` — login twice, GET /api/v1/auth/sessions, verify 2 sessions
- `TestAuthRoutes_RevokeSession` — login, revoke own session, verify invalidated

Check what `auth_integration_test.go` already covers to avoid duplication.

- [x] **Step 2: Run tests, verify coverage**

Target: auth_routes.go at 60%+.

- [x] **Step 3: Commit**

```bash
git commit -m "test(gateway): auth route handler tests — login, logout, refresh, sessions"
```

---

## Task 6: Sync Agent Tests (sync/agent.go)

**Files:**
- Create: `packages/daemon/internal/sync/agent_test.go`

125 lines, 6 functions, 0% coverage. On the critical path — pushes config to Caddy.

- [x] **Step 1: Write sync agent tests**

Tests needed:
- `TestAgent_StartStop` — start agent, stop it, verify clean shutdown (no goroutine leak)
- `TestAgent_SyncOnce` — create agent with a mock/spy Caddy manager that records PushConfig calls. Trigger a config change via the engine, verify PushConfig was called with valid JSON.
- `TestAgent_Debounce` — trigger 5 rapid config changes, verify PushConfig called approximately once (debounce collapses rapid changes)
- `TestAgent_SyncOnce_CaddyDown` — caddy manager's PushConfig returns error, verify agent logs error but doesn't crash
- `TestAgent_ContextCancellation` — start agent, cancel context, verify goroutine exits

The agent depends on `*config.Engine` (for WatchChanges) and `*caddy.Manager` (for PushConfig and IsRunning). For testing without a real Caddy process, create a `mockCaddyManager` that records calls.

Actually — looking at the agent code, it takes `*caddy.Manager` directly (concrete type). If `PushConfig` is on the concrete type, we need a real manager or to refactor to an interface. Check if we can construct a Manager with a nil cmd (it only calls PushConfig which does HTTP, and IsRunning which checks a bool).

Alternative: use a real Engine + real SQLite store + a test HTTP server that acts as Caddy's admin API (just accepts POST /config/apps and returns 200).

- [x] **Step 2: Run tests, verify coverage**

Target: agent.go at 75%+.

- [x] **Step 3: Commit**

```bash
git commit -m "test(sync): agent tests — start/stop, sync, debounce, error handling"
```

---

## Task 7: gRPC ConfigService Tests

**Files:**
- Create: `packages/daemon/internal/grpc/config_service_test.go`

173 lines, 7 RPC methods, 0% coverage.

- [x] **Step 1: Write ConfigService tests**

Tests needed:
- `TestConfigService_ApplyChange_CreateRoute` — create a route via ApplyChange, verify success response
- `TestConfigService_ApplyChange_CreateService` — create a service, verify it appears in GetConfig
- `TestConfigService_GetConfig` — seed store with routes+services, call GetConfig, verify snapshot
- `TestConfigService_GetConfig_Empty` — empty store, verify empty snapshot (not error)
- `TestConfigService_WatchChanges` — subscribe, apply a change, verify event received on stream

Follow the same pattern as `traffic_service_test.go` — create real SQLite store, construct service directly.

- [x] **Step 2: Run tests, verify coverage**

Target: config_service.go at 75%+.

- [x] **Step 3: Commit**

```bash
git commit -m "test(grpc): ConfigService RPC tests — apply changes, get config, watch"
```

---

## Task 8: gRPC HealthService Tests

**Files:**
- Create: `packages/daemon/internal/grpc/health_service_test.go`

93 lines, 2 RPC methods, 0% coverage.

- [x] **Step 1: Write HealthService tests**

Tests needed:
- `TestHealthService_GetHealth` — create service with real store, call GetHealth, verify response includes store health and version
- `TestHealthService_GetHealth_StoreDown` — store that returns unhealthy, verify reflected in response
- `TestHealthService_WatchHealth` — subscribe, verify periodic health events arrive

- [x] **Step 2: Run tests, verify coverage**

Target: health_service.go at 75%+.

- [x] **Step 3: Commit**

```bash
git commit -m "test(grpc): HealthService RPC tests — get health, watch health stream"
```

---

## Task 9: Config File Load/Validate Tests

**Files:**
- Create: `packages/daemon/internal/config/file_test.go`

671 lines, 43% coverage. Focus on uncovered validation paths.

- [x] **Step 1: Write config validation tests**

Tests needed:
- `TestConfig_Load_ValidFile` — write valid YAML to temp file, Load it, verify fields
- `TestConfig_Load_MissingFile` — non-existent path, verify error
- `TestConfig_Load_InvalidYAML` — malformed YAML, verify error
- `TestConfig_Validate_InvalidDriver` — store.driver: "invalid", verify validation error
- `TestConfig_Validate_InvalidTraceStore` — traces.store: "invalid", verify error
- `TestConfig_Validate_SamplingRateOutOfRange` — rate: 2.0, verify error
- `TestConfig_Validate_NegativeMaxSize` — max_size_gb: -1, verify error
- `TestConfig_ApplyDefaults_TracesPath` — set data_dir to custom, verify traces.path derived correctly
- `TestConfig_ApplyDefaults_BufferSize` — verify default buffer_size is 10000
- `TestConfig_Default` — verify Default() returns sensible config with all required fields

- [x] **Step 2: Run tests, verify coverage**

Target: file.go at 70%+.

- [x] **Step 3: Commit**

```bash
git commit -m "test(config): config load, validate, and defaults tests"
```

---

## Task 10: Fix Existing Test Issues

**Files:**
- Modify: `packages/daemon/internal/gateway/security_test.go`
- Modify: `packages/daemon/internal/gateway/failure_test.go`

- [x] **Step 1: Fix timing attack test**

In `security_test.go`, the timing test at ~line 224 logs but doesn't fail. Change to either:
- `t.Errorf` if timing difference > threshold (makes it a real regression test)
- Or `t.Skip("timing attack test is informational — see #XX")` with a GitHub issue

- [x] **Step 2: Fix panic documentation test**

In `failure_test.go` ~line 335, the `migrate_without_open` subtest catches a panic silently. Either:
- File a GitHub issue for the panic
- Change the test to `t.Skip("known issue: migrate on unopened driver panics — see #XX")`

- [x] **Step 3: Commit**

```bash
git commit -m "fix(test): make timing attack test actionable, track migrate panic as issue"
```

---

## Task 11: Gateway Middleware Tests

**Files:**
- Create: `packages/daemon/internal/gateway/middleware_test.go`

Tests for error formatting, CORS middleware, and security headers.

- [x] **Step 1: Write middleware tests**

Tests needed:
- `TestCORSMiddleware_AllowedOrigin` — request with allowed origin, verify CORS headers in response
- `TestCORSMiddleware_DisallowedOrigin` — request with disallowed origin, verify no CORS headers
- `TestCORSMiddleware_Preflight` — OPTIONS request, verify 204 with proper headers
- `TestSecurityHeaders` — any request, verify X-Content-Type-Options, X-Frame-Options, CSP headers set
- `TestRequestIDMiddleware` — request without ID, verify one is generated. Request with ID, verify it's passed through
- `TestErrorResponse_RFC7807` — trigger a 400/404/500 error, verify response matches ProblemDetail format

- [x] **Step 2: Run tests, verify coverage**

Target: errors.go, security_middleware.go, cors middleware at 70%+.

- [x] **Step 3: Commit**

```bash
git commit -m "test(gateway): middleware tests — CORS, security headers, request ID, error format"
```

---

## Task 12: Final Coverage Validation

- [x] **Step 1: Run full coverage report**

```bash
cd packages/daemon
go test -coverprofile=coverage.out -race ./...
go tool cover -func=coverage.out | grep "total:"
```

Target: `total: 80.0%` or higher.

- [x] **Step 2: Per-package report**

```bash
go tool cover -func=coverage.out | grep -v "100.0%" | sort -t'%' -k3 -n | tail -20
```

Verify no package with >100 lines of code is below 50%.

- [x] **Step 3: Run full test suite**

```bash
make test-race
```

Expected: All PASS.

- [x] **Step 4: Commit coverage baseline**

```bash
git commit -m "test: coverage improvement — 45% to 80%+"
```
