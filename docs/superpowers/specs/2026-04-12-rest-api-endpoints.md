# REST API Endpoints: User/Role Delta, Settings, Traffic Dashboard, Multi-Backend CI, Graceful Degradation

**Date**: 2026-04-12 (revised)
**Scope**: Five work items with honest assessment of what exists vs. what needs building

---

## What Already Exists (Verified Against Source Code)

Before specifying delta work, here is a complete inventory of existing REST endpoints as registered in `packages/daemon/internal/gateway/gateway.go`.

### Auth routes (`auth_routes.go`)

| Method | Path | Handler | Status |
| ------ | ---- | ------- | ------ |
| POST | `/api/v1/auth/token` | `handleTokenExchange` | Implemented |
| POST | `/api/v1/auth/refresh` | `handleTokenRefresh` | Implemented |
| POST | `/api/v1/auth/login` | `handleLogin` | Implemented (with TOTP) |
| POST | `/api/v1/auth/logout` | `handleLogout` | Implemented |
| GET | `/api/v1/auth/me` | `handleMe` | Implemented |
| POST | `/api/v1/auth/password` | `handlePasswordChange` | Implemented |
| PATCH | `/api/v1/auth/me` | `handleUpdateProfile` | Implemented |
| GET | `/api/v1/auth/sessions` | `handleListSessions` | Implemented (own sessions only) |
| DELETE | `/api/v1/auth/sessions/{id}` | `handleRevokeSessionByID` | Implemented |

### User management routes (`user_routes.go`)

| Method | Path | Handler | Permission | Status |
| ------ | ---- | ------- | ---------- | ------ |
| GET | `/api/v1/users` | `handleListUsers` | `users:read` | Implemented |
| POST | `/api/v1/users` | `handleCreateUser` | `users:create` | Implemented |
| GET | `/api/v1/users/{id}` | `handleGetUser` | `users:read` | Implemented |
| PATCH | `/api/v1/users/{id}` | `handleUpdateUser` | `users:manage` | Implemented |
| POST | `/api/v1/users/{id}/suspend` | `handleSuspendUser` | `users:manage` | Implemented |
| POST | `/api/v1/users/{id}/activate` | `handleActivateUser` | `users:manage` | Implemented |
| POST | `/api/v1/users/{id}/lock` | `handleLockUser` | `users:manage` | Implemented |
| POST | `/api/v1/users/{id}/unlock` | `handleUnlockUser` | `users:manage` | Implemented |
| POST | `/api/v1/users/{id}/reset-password` | `handleResetPassword` | `users:manage` | Implemented |

### RBAC routes (`rbac_routes.go`)

| Method | Path | Handler | Permission | Status |
| ------ | ---- | ------- | ---------- | ------ |
| GET | `/api/v1/roles` | `handleListRoles` | `roles:read` | Implemented |
| POST | `/api/v1/roles` | `handleCreateRole` | `roles:manage` | Implemented |
| GET | `/api/v1/roles/{id}` | `handleGetRole` | `roles:read` | Implemented |
| PATCH | `/api/v1/roles/{id}` | `handleUpdateRole` | `roles:manage` | Implemented |
| DELETE | `/api/v1/roles/{id}` | `handleDeleteRole` | `roles:manage` | Implemented |
| GET | `/api/v1/permissions` | `handleListPermissions` | `roles:read` | Implemented |
| GET | `/api/v1/users/{id}/roles` | `handleListUserRoles` | `users:read` | Implemented |
| POST | `/api/v1/users/{id}/roles` | `handleAssignRole` | `users:manage` | Implemented |
| DELETE | `/api/v1/users/{id}/roles/{roleId}` | `handleRevokeRole` | `users:manage` | Implemented |

### Stub routes (`stub_routes.go`)

| Method | Path | Returns | Status |
| ------ | ---- | ------- | ------ |
| GET | `/api/v1/cluster` | Hostname, driver, version | Static stub |
| GET | `/api/v1/plugins` | `[]` | Static stub |
| GET | `/api/v1/plugins/manifest` | `[]` | Static stub |
| GET | `/api/v1/settings` | Config-derived summary | Static stub |

### Actual response shapes (verified from code)

**`userResponse`** (from `user_routes.go` line 32):

```json
{
  "id": "uuid",
  "username": "admin",
  "displayName": "Admin User",
  "email": "admin@example.com",
  "roles": ["superadmin"],
  "permissions": ["*"],
  "totpEnabled": false,
  "forcePasswordChange": false,
  "status": "active",
  "lastLogin": "2026-04-12T12:00:00Z",
  "createdAt": "2026-04-12T00:00:00Z"
}
```

Key differences from the original spec: camelCase field names (not snake_case), `totpEnabled` (not `mfa_enabled`), `displayName` (not absent), `forcePasswordChange` included, no pagination wrapper -- `GET /api/v1/users` returns a bare JSON array.

**`roleResponse`** (from `rbac_routes.go` line 35):

```json
{
  "id": "uuid",
  "name": "superadmin",
  "description": "Full administrative access",
  "isBuiltin": true,
  "permissions": ["*"]
}
```

Permissions are a flat string array (e.g., `["users:read", "routes:manage"]`), not the expanded `{resource, actions}` structure the original spec assumed.

---

## Implementation Order

1. **#79 -- User & role management REST API delta** (small additions to existing code)
2. **#78 -- Settings endpoints** (GET-only for v1, PATCH deferred)
3. **#81 -- Traffic dashboard** (depends on TraceStore capabilities)
4. **#123 -- Graceful degradation** (independent, deeper design needed -- separate section)
5. **#130 -- CI multi-backend store testing** (blocked on postgres/mysql driver implementation -- note only)

---

## #79 -- User & Role Management REST API (Delta Work)

### What already works

The user and role CRUD is **complete**. All endpoints listed above are implemented, permission-gated, and return proper RFC 7807 problem details on errors. The existing code handles:

- Full user lifecycle: create, read, update, suspend, activate, lock, unlock, reset-password
- Full role lifecycle: create, read, update, delete with immutability guard on superadmin
- Permission listing, user-role assignment and revocation
- Session listing for the authenticated user (`GET /api/v1/auth/sessions`)
- Session revocation with ownership check or `sessions:manage` permission

### Delta work needed

Only three gaps remain:

#### 1. Soft-delete user (DELETE /api/v1/users/{id})

The store layer has `DeleteUser` which does a hard `DELETE FROM users`. The admin panel needs a soft-delete that sets `status = 'deleted'` and revokes all sessions, but preserves the row for audit trail purposes.

**Approach**: Add a new handler `handleDeleteUser` that:

1. Requires `users:manage` permission
2. Sets `user.Status = "deleted"` via `UpdateUser` (not `DeleteUser`)
3. Revokes all sessions for the user via `sm.RevokeAllSessionsForUser`
4. Returns 204 No Content

Register as: `mux.Handle("DELETE /api/v1/users/{id}", RequirePermission("users:manage")(http.HandlerFunc(handleDeleteUser(st, sm))))`

**Login handling for deleted users**: Verify that `handleLogin` in `auth_routes.go` handles `status = 'deleted'` the same as `status = 'suspended'` (returns 403 Forbidden). If not, add explicit handling so that soft-deleted users cannot authenticate. The existing login handler checks for `suspended` and `locked` statuses but may not check for `deleted` since hard-delete was the previous approach.

#### 2. Admin session listing for other users (GET /api/v1/users/{id}/sessions)

`GET /api/v1/auth/sessions` lists the caller's own sessions. There is no endpoint to list another user's sessions. The store already has `ListSessionsByUser(ctx, userID)`.

**Approach**: Add a new handler in `user_routes.go`:

```
mux.Handle("GET /api/v1/users/{id}/sessions",
    RequirePermission("sessions:read")(http.HandlerFunc(handleListUserSessions(st))))
```

The handler calls `tx.ListSessionsByUser(ctx, userID)` and returns the same `sessionResponse` shape used in `auth_routes.go`.

#### 3. Role with user count

`GET /api/v1/roles/{id}` returns the role but not how many users have it. The store has `ListUsersWithRole(ctx, roleID)` which returns user IDs.

**Approach**: In `handleGetRole`, after fetching the role, call `tx.ListUsersWithRole(ctx, id)` and add `"userCount": len(userIDs)` to the response. Extend `roleResponse` with `UserCount int`:

```json
{
  "id": "uuid",
  "name": "editor",
  "description": "...",
  "isBuiltin": false,
  "permissions": ["routes:read", "services:read"],
  "userCount": 3
}
```

### Files to modify

- **`packages/daemon/internal/gateway/user_routes.go`** -- Add `handleDeleteUser`, `handleListUserSessions`, register new routes
- **`packages/daemon/internal/gateway/rbac_routes.go`** -- Add `UserCount` to `roleResponse`, call `ListUsersWithRole` in `handleGetRole`
- **`packages/daemon/internal/gateway/gateway.go`** -- No changes (routes registered inside `RegisterUserRoutes`/`RegisterRBACRoutes`)

### Tests

| Test | What it validates |
| ---- | ----------------- |
| `TestDeleteUser_SoftDelete` | Sets status to "deleted", revokes sessions, user still in DB |
| `TestDeleteUser_NotFound` | Returns 404 for unknown ID |
| `TestDeleteUser_Unauthorized` | Returns 403 without `users:manage` permission |
| `TestListUserSessions_Admin` | Returns sessions for another user with `sessions:read` |
| `TestListUserSessions_Unauthorized` | Returns 403 without `sessions:read` |
| `TestGetRole_WithUserCount` | Response includes `userCount` field |

---

## #78 -- Settings Endpoints (GET-Only for v1)

### Honest assessment

The `config.Config` struct in `file.go` is loaded once at startup via `config.Load(path)`. There is **no** mechanism to:

- Write the config back to disk (`Save` / `Write` function does not exist)
- Reload the running daemon's config after a file change (no reload signal, no hot-reload)
- Atomically apply partial config changes to a running daemon

Building a full PATCH-and-reload system is significant work involving file locking, config diffing, graceful service restarts, and validation of the running state. This is deferred to a separate spike.

### v1 scope: GET-only endpoints

Replace the current monolithic `GET /api/v1/settings` stub with category-specific GET endpoints that read from the in-memory `*config.Config` struct. No file writes, no reload.

**Permission requirement**: All 7 settings GET endpoints require `settings:read` permission via the existing `RequirePermission` middleware. Route registration wraps each handler: `RequirePermission("settings:read")(http.HandlerFunc(handler))`.

### Endpoints

| Method | Path | Source | Description |
| ------ | ---- | ------ | ----------- |
| GET | `/api/v1/settings/general` | `Config` struct + runtime | Log level, data dir, daemon version, Go version, uptime |
| GET | `/api/v1/settings/network` | `Config.Listen` | gRPC and REST addresses, admin domain |
| GET | `/api/v1/settings/store` | `Config.Store` + `store.Driver.Health()` | Backend type, connection info, health, migration version |
| GET | `/api/v1/settings/auth` | `Config.Auth` | Password policy, lockout config, rate limiting, CORS |
| GET | `/api/v1/settings/traces` | `Config.Traces` | Sampling config, retention, store type |
| GET | `/api/v1/settings/pki` | `Config.PKI` | Key algorithm, passphrase source, rotation thresholds |
| GET | `/api/v1/settings/caddy` | `Config.Caddy` | Binary path, admin addr, traffic addrs |

### Response shapes

**`GET /api/v1/settings/general`**:

```json
{
  "logLevel": "info",
  "dataDir": "/var/lib/rioku",
  "daemonVersion": "0.1.0-dev",
  "goVersion": "go1.24.2",
  "uptimeSeconds": 86400
}
```

**`GET /api/v1/settings/store`**:

```json
{
  "driver": "raft",
  "connection": "127.0.0.1:7779",
  "healthy": true,
  "migrationVersion": 4
}
```

**`migrationVersion` source note**: `migrationVersion` comes from `store.Driver.CurrentVersion(ctx)`, not from `Health()`. The `Health()` method returns connectivity/readiness status only. `CurrentVersion` returns the highest applied migration number.

**`GET /api/v1/settings/auth`**:

```json
{
  "passwordPolicy": {
    "minLength": 12,
    "requireUppercase": true,
    "requireLowercase": true,
    "requireDigit": true,
    "requireSpecial": false,
    "maxAgeDays": 0
  },
  "lockout": {
    "maxAttempts": 5,
    "lockoutDurationMinutes": 15,
    "resetAfterMinutes": 30
  },
  "rateLimit": {
    "requestsPerMinute": 60,
    "burstSize": 10
  }
}
```

### PATCH deferral note

PATCH endpoints for mutable settings are deferred to a separate spec that will address:

- Adding `Save(path string) error` to `config/file.go`
- Atomic file write with temp-file + rename
- Daemon reload signal mechanism (SIGHUP or internal channel)
- Validation of the merged config before persisting
- Which settings are safe to change at runtime vs. require restart

### Files to modify

- **`packages/daemon/internal/gateway/stub_routes.go`** -- Remove the monolithic `GET /api/v1/settings` stub, replace with `RegisterSettingsRoutes` call
- **`packages/daemon/internal/gateway/settings_routes.go`** (new) -- Seven GET handlers, route registration
- **`packages/daemon/internal/gateway/gateway.go`** -- Call `RegisterSettingsRoutes(topMux, cfg, st)` where `RegisterStubRoutes` is called

### Tests

| Test | What it validates |
| ---- | ----------------- |
| `TestGetSettings_General` | Returns log level, data dir, versions, uptime > 0 |
| `TestGetSettings_Store` | Returns driver type, connection string, health status |
| `TestGetSettings_Auth` | Returns password policy and lockout config matching Config struct |
| `TestGetSettings_AllEndpoints` | All 7 GET endpoints return 200 with Content-Type application/json |
| `TestGetSettings_Unauthenticated` | Returns 401 without valid auth |

---

## #81 -- Traffic Dashboard & Per-Entity Analytics

### Honest assessment of TraceStore capabilities

The TraceStore Driver interface (`tracestore/driver.go`) provides:

| Method | Signature | What it can do |
| ------ | --------- | -------------- |
| `GetStatsBuckets` | `(ctx, since, until time.Time) ([]StatsBucket, error)` | Global stats by time range. No per-route/service filtering. |
| `GetRouteBuckets` | `(ctx, since, until time.Time) ([]RouteBucket, error)` | Per-route stats by time range. Has `RouteID` field. |
| `GetStatusBuckets` | `(ctx, since, until time.Time) ([]StatusBucket, error)` | Per-status-class by time range. No per-route filtering. |
| `GetModelBuckets` | `(ctx, since, until time.Time) ([]ModelBucket, error)` | Per-model AI stats by time range. |
| `QueryTraces` | `(ctx, *TraceQuery) ([]*RequestTrace, int64, error)` | Raw traces with filtering by `route_ids`, `status_codes`, `actor_id`, `session_id`, `ai_only`. |

**Key limitations**:

1. `GetStatsBuckets` returns **global** stats only -- no route or service filter parameter. Per-route stats come from `GetRouteBuckets` which returns **all** routes' buckets; client-side filtering by route ID is needed.
2. `GetStatusBuckets` has no per-route filter -- status distribution for a single route requires `QueryTraces` with route_id filter and client-side aggregation.
3. There is no per-**service** bucket table or filter. A service's traffic is the union of all routes that target it. Getting per-service stats requires: looking up which routes target the service, then filtering `GetRouteBuckets` results by those route IDs.
4. There is no upstream-level stats tracking. The `upstream_stats` in the original spec is not implementable from the current TraceStore.
5. Bucket intervals are fixed at the write side (the aggregator writes 1-minute buckets). The `GetStatsBuckets` query returns raw minute buckets; coarser intervals (5m, 15m, 1h, 6h) must be computed by the handler via client-side re-aggregation.

### What is implementable now

#### Dashboard endpoint: `GET /api/v1/traffic/dashboard`

Query parameters: `range` (default `24h`, values: `1h`, `6h`, `24h`, `7d`, `30d`)

Uses `GetStatsBuckets` for global time series and stat cards, `GetRouteBuckets` for top routes, `GetStatusBuckets` for status distribution.

Response:

```json
{
  "statCards": {
    "totalRequests": 145832,
    "avgLatencyMs": 42,
    "errorRate": 0.023,
    "activeRoutes": 12,
    "requestsPerSecond": 1.68
  },
  "timeSeries": [
    {
      "timestamp": "2026-04-12T00:00:00Z",
      "requests": 5420,
      "avgLatencyMs": 38,
      "errorCount": 120,
      "p50LatencyMs": 25,
      "p95LatencyMs": 95,
      "p99LatencyMs": 210
    }
  ],
  "topRoutes": [
    {
      "routeId": "uuid",
      "requestCount": 45000,
      "errorCount": 450,
      "avgLatencyMs": 35
    }
  ],
  "statusDistribution": {
    "2xx": 140000,
    "3xx": 200,
    "4xx": 5000,
    "5xx": 632
  },
  "range": "24h"
}
```

**`avgLatencyMs` computation note**: P50 (median) is used as a proxy for average latency in v1. `StatsBucket` has `P50LatencyMS` but no true arithmetic mean field. True average requires a schema extension to `StatsBucket` adding a `TotalLatencyMS` accumulator (deferred). The same applies to `avgLatencyMs` in per-route and per-service stat cards, where `RouteBucket.AvgLatencyMS` is actually the bucket-level average already computed by the aggregator.

**`topRoutes` limit**: `topRoutes` limited to top 10 by request count, ordered descending. The handler sorts `GetRouteBuckets` results by total request count and truncates to 10 entries.

Implementation: call `GetStatsBuckets`, `GetRouteBuckets`, `GetStatusBuckets` for the time range. Re-aggregate minute buckets into the desired interval. Compute stat cards from the aggregated data.

#### Per-route endpoint: `GET /api/v1/traffic/routes/{id}`

Uses `GetRouteBuckets` filtered client-side by route ID for time series. Uses `QueryTraces` with `route_ids=[id]` for status distribution (aggregate `status_code` from raw traces).

Response:

```json
{
  "routeId": "uuid",
  "statCards": {
    "totalRequests": 45000,
    "avgLatencyMs": 35,
    "errorCount": 450,
    "requestsPerSecond": 0.52
  },
  "timeSeries": [
    {
      "timestamp": "2026-04-12T00:00:00Z",
      "requests": 1800,
      "errorCount": 18,
      "avgLatencyMs": 32
    }
  ],
  "statusDistribution": {
    "2xx": 44550,
    "4xx": 200,
    "5xx": 250
  },
  "range": "24h"
}
```

**Note**: Per-route time series does not include p50/p95/p99 latency because `RouteBucket` only has `AvgLatencyMS`. Percentile latency is only available in global `StatsBucket`.

#### Per-service endpoint: `GET /api/v1/traffic/services/{id}`

This is **partially implementable**. The handler must:

1. Look up which routes target this service (from the config snapshot)
2. Filter `GetRouteBuckets` results by those route IDs
3. Aggregate across routes

Response (reduced from original spec -- no upstream-level stats):

```json
{
  "serviceId": "uuid",
  "routeIds": ["route-1", "route-2"],
  "statCards": {
    "totalRequests": 90000,
    "avgLatencyMs": 36,
    "errorCount": 900,
    "requestsPerSecond": 1.04
  },
  "timeSeries": [
    {
      "timestamp": "2026-04-12T00:00:00Z",
      "requests": 3600,
      "errorCount": 36,
      "avgLatencyMs": 34
    }
  ],
  "range": "24h"
}
```

**Deferred**: `upstream_stats` (per-upstream request counts, latency, health) requires TraceStore schema changes to track upstream-level data. This is not currently recorded.

### Time range to re-aggregation mapping

The aggregator writes 1-minute buckets. The handler re-aggregates into coarser intervals for the response:

| Range | Output interval | Re-aggregate N minute buckets | Max output points |
| ----- | --------------- | ----------------------------- | ----------------- |
| `1h` | 1 min | 1 | 60 |
| `6h` | 5 min | 5 | 72 |
| `24h` | 15 min | 15 | 96 |
| `7d` | 1 hour | 60 | 168 |
| `30d` | 6 hours | 360 | 120 |

### Files to modify

- **`packages/daemon/internal/gateway/traffic_routes.go`** (new) -- Dashboard, per-route, per-service handlers
- **`packages/daemon/internal/gateway/gateway.go`** -- Call `RegisterTrafficRoutes(topMux, engine, traceDriver)` in the route registration block
- **`packages/daemon/internal/gateway/traffic_routes_test.go`** (new) -- Integration tests

### Tests

| Test | What it validates |
| ---- | ----------------- |
| `TestTrafficDashboard_Default24h` | Returns stat cards + time series for 24h range |
| `TestTrafficDashboard_AllRanges` | All range values produce correct number of output buckets |
| `TestTrafficDashboard_InvalidRange` | Returns 400 for unsupported range value |
| `TestTrafficDashboard_Empty` | No traces returns zero-value stat cards and empty arrays |
| `TestTrafficRoute_Found` | Returns per-route stats with status distribution |
| `TestTrafficRoute_NotFound` | Returns 404 for route ID with no data |
| `TestTrafficService_Found` | Returns per-service stats aggregated from child routes |
| `TestTrafficService_NoRoutes` | Service with no routes returns zero-value response |
| `TestTrafficDashboard_ReAggregation` | Minute buckets correctly rolled up to 15-min output for 24h range |

---

## #123 -- Graceful Degradation When Store Offline (Separate Section)

This item needs deeper design than the original spec provided. It is split into its own section rather than being a line item.

### Problem

When the config store (sqlite/raft) becomes unreachable, the entire daemon stops serving API requests even though Caddy (the traffic plane) continues running independently. The daemon should degrade gracefully: serve cached config for reads, reject writes with 503.

### Design considerations requiring spike work

1. **Cold start with no cache**: If the daemon starts and the store is immediately unreachable, there is no cached snapshot. The daemon cannot serve config reads or compile Caddy config. What should happen? Options: block startup until store is available, start with empty config, fail fast.

2. **Cache lifecycle**: When does the cache become stale? Should there be a staleness TTL after which the daemon stops serving from cache and returns 503 instead?

3. **Store reconnection**: When the store comes back online, the daemon needs to re-validate the cache against the actual store state. If mutations happened via another node (raft cluster), the cache may be behind.

4. **Sync agent awareness**: The Caddy sync agent pushes config to Caddy after mutations. If the store is offline, the sync agent should not attempt to push stale config. It needs to know about the degraded state.

5. **Raft-specific behavior**: The raft driver has its own leader election and consensus. A raft node that loses quorum cannot serve reads either (linearizable reads require quorum). The cache layer needs to sit above the store driver, not inside it.

### Proposed v1 implementation (minimal)

Add a `cachedSnapshot` field to `Engine`:

```go
type Engine struct {
    store           store.Driver
    compiler        *caddy.Compiler
    mu              sync.RWMutex
    cachedSnapshot  *riokuv1.ConfigSnapshot
}
```

- After every successful `buildSnapshot` call, update `cachedSnapshot`
- In `GetConfig`, if the store read fails and `cachedSnapshot` is non-nil, return the cached snapshot with a warning
- In `ApplyChange`, if the store is unreachable, return an error (no write-through cache)
- In `Health()`, report degraded when serving from cache

### Deferred to spike

- Cold start behavior
- Cache staleness TTL
- Multi-node cache consistency
- Sync agent interaction

### Files to modify

- **`packages/daemon/internal/config/engine.go`** -- Add `cachedSnapshot` field, update after successful reads, fallback on errors
- **`packages/daemon/internal/config/engine_test.go`** -- Cache fallback tests with a mock store that returns errors

### Tests

| Test | What it validates |
| ---- | ----------------- |
| `TestEngine_CacheFallback_Read` | Store error returns cached snapshot when available |
| `TestEngine_CacheFallback_Write` | Store error on write returns error (no cache write-through) |
| `TestEngine_CacheFallback_NoCacheYet` | Store error with no cache returns error |
| `TestEngine_CacheUpdatedOnSuccess` | Successful read updates cached snapshot |

---

## #130 -- CI Multi-Backend Store Testing (Note)

This item is **blocked** on the postgres and mysql store drivers being implemented. Currently:

- `packages/daemon/internal/store/postgres/postgres.go` -- package declaration only (3 lines)
- `packages/daemon/internal/store/mysql/mysql.go` -- package declaration only (3 lines)

There is no code to test. Migration SQL files exist for postgres (000002-000004) and mysql (000002-000004), but neither dialect has a 000001 initial schema migration, and neither has any Go driver code.

### What is needed before CI multi-backend

1. Implement `store.Driver` for postgres (at minimum: `Open`, `Migrate`, `Begin`, all `Tx` methods)
2. Write the 000001 initial schema migration for postgres
3. Same for mysql
4. Then: add docker-compose services, CI matrix, and test helper

### Deferred

This entire item is deferred to its own spec: "Implement Postgres and MySQL Store Drivers". The CI multi-backend testing is the validation step of that spec, not a standalone work item.

---

## Testing Strategy

All tests use real databases (no mocks), table-driven style, run with `-race`.

### Sandbox integration

After implementing the above, the following sandbox smoke tests apply:

- Hit all new settings endpoints with seeded data, verify 200 responses
- Hit traffic dashboard with the 5 upstream apps generating traffic
- Verify user soft-delete works end-to-end (delete user, verify sessions revoked, user still queryable with status "deleted")

---

## Acceptance Criteria

### #79 -- User & role API delta

- [ ] `DELETE /api/v1/users/{id}` soft-deletes user (sets status to "deleted", revokes sessions)
- [ ] `GET /api/v1/users/{id}/sessions` returns sessions for any user with `sessions:read` permission
- [ ] `GET /api/v1/roles/{id}` includes `userCount` field
- [ ] All existing user and role endpoints continue working unchanged
- [ ] Response shapes use camelCase and match actual code (`totpEnabled`, `displayName`, etc.)

### #78 -- Settings (GET-only v1)

- [ ] All 7 `GET /api/v1/settings/*` endpoints return 200 with correct JSON shapes
- [ ] `GET /api/v1/settings/store` includes live health status from `store.Driver.Health()`
- [ ] Settings endpoints require authentication
- [ ] Monolithic `GET /api/v1/settings` stub is removed or redirects

### #81 -- Traffic dashboard

- [ ] `GET /api/v1/traffic/dashboard` returns stat cards and time series from TraceStore
- [ ] `GET /api/v1/traffic/routes/{id}` returns per-route stats with status distribution
- [ ] `GET /api/v1/traffic/services/{id}` returns per-service stats aggregated from child routes
- [ ] All range values (`1h`, `6h`, `24h`, `7d`, `30d`) produce correctly re-aggregated buckets
- [ ] Empty TraceStore returns zero-value stat cards and empty arrays (not errors)
- [ ] Response shapes use camelCase consistently

### #123 -- Graceful degradation (minimal v1)

- [ ] Store goes offline with populated cache: read operations return cached data
- [ ] Store goes offline: write operations return error
- [ ] Cache is updated after every successful store read
- [ ] No cache available + store offline: read returns error

### #130 -- CI multi-backend

- [ ] Deferred -- spec written, blocked on postgres/mysql driver implementation
