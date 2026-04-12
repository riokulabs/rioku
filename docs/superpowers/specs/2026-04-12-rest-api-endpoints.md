# REST API Endpoints: CI Multi-Backend, Graceful Degradation, User/Role API, Settings, Traffic Dashboard

**Date**: 2026-04-12
**Scope**: Five related work items — CI store testing (#130), graceful degradation (#123), user/role REST API (#79), settings endpoints (#78), traffic dashboard (#81)

---

## Implementation Order

1. **#130 — CI multi-backend store testing** (catches bugs early)
2. **#123 — Graceful degradation when store offline** (reliability foundation)
3. **#79 — User & role management REST API** (partial wiring exists)
4. **#78 — Settings endpoints** (file-based, straightforward)
5. **#81 — Traffic dashboard & per-entity analytics** (query layer on top of TraceStore)

---

## #130 — CI Multi-Backend Store Testing

### Overview

Add Postgres and MariaDB to the CI test matrix so all store tests run against all three backends.

### Docker Compose

Add `docker-compose.test.yml` (or extend existing compose file) at repo root:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: rioku_test
      POSTGRES_PASSWORD: rioku_test
      POSTGRES_DB: rioku_test
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rioku_test"]
      interval: 2s
      timeout: 5s
      retries: 10

  mariadb:
    image: mariadb:11
    environment:
      MYSQL_ROOT_PASSWORD: rioku_test
      MYSQL_DATABASE: rioku_test
      MYSQL_USER: rioku_test
      MYSQL_PASSWORD: rioku_test
    ports:
      - "3306:3306"
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 2s
      timeout: 5s
      retries: 10
```

### Environment Variable

`RIOKU_TEST_STORE` selects the backend for store tests:

| Value | Backend | Connection |
|-------|---------|------------|
| `sqlite` (default) | SQLite | In-memory or temp file |
| `postgres` | PostgreSQL 16 | `postgres://rioku_test:rioku_test@localhost:5432/rioku_test?sslmode=disable` |
| `mysql` | MariaDB 11 | `rioku_test:rioku_test@tcp(localhost:3306)/rioku_test` |

Store test helper function reads `RIOKU_TEST_STORE` and returns the appropriate store implementation. If the env var is set to a backend that is not reachable, tests skip with `t.Skip("backend not available")`.

### CI Workflow

In `.github/workflows/test.yml`, add a matrix strategy:

```yaml
strategy:
  matrix:
    store: [sqlite, postgres, mysql]
```

For `postgres` and `mysql` matrix entries, start the corresponding Docker Compose service before running tests. SQLite needs no external service.

### Files to modify

- **`docker-compose.test.yml`** (new) — Postgres and MariaDB services
- **`.github/workflows/test.yml`** — Matrix strategy, docker compose up, env var
- **`packages/daemon/internal/store/testutil.go`** (new or extend existing) — Helper that returns store based on `RIOKU_TEST_STORE`
- **Existing store test files** — Update to use the helper instead of hardcoded SQLite

---

## #123 — Graceful Degradation When Store Offline

### Overview

Cache the last known `ConfigSnapshot` in memory. When the store is unreachable, serve reads from cache and reject writes with 503.

### Cache Layer

In `packages/daemon/internal/config/engine.go`:

- Add a `cachedSnapshot` field (type `*ConfigSnapshot`, protected by `sync.RWMutex`)
- After every successful store read that produces a full snapshot, update `cachedSnapshot`
- On store error during read operations, check if `cachedSnapshot` is non-nil; if so, return it with a degraded warning in the response metadata
- On store error during write operations, return HTTP 503 with body `{"error": "config store unavailable", "status": "degraded"}`

### Health Endpoint

In `packages/daemon/internal/grpc/health_service.go`:

- Add a `degraded` state alongside existing healthy/unhealthy
- When store is unreachable but cache is populated: report `"status": "degraded"`
- Include `store_status` field in health response: `"online"`, `"offline"`, `"unknown"`
- Caddy process status remains independent (Caddy runs as a child process, not affected by store outage)

### Behavior Matrix

| Store state | Read request | Write request | Health endpoint | Caddy |
|-------------|-------------|---------------|-----------------|-------|
| Online | Serve from store | Process normally | `healthy` | Running |
| Offline, cache populated | Serve from cache | 503 | `degraded` | Running |
| Offline, no cache | 503 | 503 | `unhealthy` | Running |

TraceStore is unaffected — traces use an in-memory ring buffer independent of the config store.

### Files to modify

- **`packages/daemon/internal/config/engine.go`** — Add `cachedSnapshot` field, update on successful reads, fallback on store errors
- **`packages/daemon/internal/grpc/health_service.go`** — Add degraded state, `store_status` field
- **`packages/daemon/internal/config/engine_test.go`** — Tests for cache fallback behavior
- **`packages/daemon/internal/grpc/health_service_test.go`** — Tests for degraded reporting

---

## #79 — User & Role Management REST API

### Overview

The store layer has full CRUD for users and roles. The gateway has `user_routes.go` and `rbac_routes.go`. This work verifies registration, wires list endpoints, and adds session and expanded role endpoints.

### Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/auth/users` | `listUsers` | Paginated user list with roles, status, MFA |
| `GET` | `/auth/users/:id` | `getUser` | Single user with full profile |
| `POST` | `/auth/users` | `createUser` | Create user |
| `PATCH` | `/auth/users/:id` | `updateUser` | Update user fields |
| `DELETE` | `/auth/users/:id` | `deleteUser` | Soft-delete user |
| `GET` | `/auth/users/:id/sessions` | `listUserSessions` | Active sessions for user |
| `GET` | `/auth/roles` | `listRoles` | All roles with permission rules |
| `GET` | `/auth/roles/:id` | `getRole` | Single role with expanded permissions |
| `POST` | `/auth/roles` | `createRole` | Create role |
| `PATCH` | `/auth/roles/:id` | `updateRole` | Update role |
| `DELETE` | `/auth/roles/:id` | `deleteRole` | Delete role |

### Response Shapes

**`GET /auth/users`**:
```json
{
  "users": [
    {
      "id": "uuid",
      "username": "admin",
      "email": "admin@example.com",
      "roles": ["admin"],
      "status": "active",
      "mfa_enabled": true,
      "created_at": "2026-04-12T00:00:00Z",
      "last_login": "2026-04-12T12:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "per_page": 25
}
```

**`GET /auth/users/:id/sessions`**:
```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "ip": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2026-04-12T10:00:00Z",
      "expires_at": "2026-04-12T22:00:00Z",
      "current": true
    }
  ]
}
```

**`GET /auth/roles/:id`**:
```json
{
  "id": "uuid",
  "name": "admin",
  "description": "Full administrative access",
  "permissions": [
    {"resource": "routes", "actions": ["create", "read", "update", "delete"]},
    {"resource": "services", "actions": ["create", "read", "update", "delete"]},
    {"resource": "users", "actions": ["create", "read", "update", "delete"]}
  ],
  "user_count": 2,
  "created_at": "2026-04-12T00:00:00Z"
}
```

### Files to modify

- **`packages/daemon/internal/gateway/user_routes.go`** — Verify route registration, add `listUserSessions` handler, ensure JSON array responses
- **`packages/daemon/internal/gateway/rbac_routes.go`** — Verify route registration, add expanded role endpoint with permissions
- **`packages/daemon/internal/gateway/user_routes_test.go`** — Integration tests
- **`packages/daemon/internal/gateway/rbac_routes_test.go`** — Integration tests

---

## #78 — Settings Endpoints (File-Based for v1)

### Overview

Settings are read from and written to `rioku.yaml`. PATCH writes to the file and triggers a config reload. Seven GET endpoints cover all setting categories. Four categories are mutable via PATCH.

### Endpoints

| Method | Path | Mutable | Description |
|--------|------|---------|-------------|
| `GET` | `/settings/general` | Yes | Instance name, log level, daemon version, Go version |
| `GET` | `/settings/network` | Yes | Listen addresses (gRPC, REST), trusted proxies |
| `GET` | `/settings/tls` | No | ACME config, min TLS version, certificate info |
| `GET` | `/settings/observability` | Yes | Trace sampling rate, retention period |
| `GET` | `/settings/authentication` | Yes | Session duration, password policy, lockout config |
| `GET` | `/settings/config-store` | No | Backend type, connection health, migration status |
| `GET` | `/settings/pki` | No | CA status, rotation history, certificate chain |
| `PATCH` | `/settings/general` | - | Update instance name, log level |
| `PATCH` | `/settings/network` | - | Update listen addresses, trusted proxies |
| `PATCH` | `/settings/observability` | - | Update trace sampling, retention |
| `PATCH` | `/settings/authentication` | - | Update session, password, lockout config |

### Response Shapes

**`GET /settings/general`**:
```json
{
  "instance_name": "rioku-prod-1",
  "log_level": "info",
  "daemon_version": "0.3.0",
  "go_version": "1.24.2",
  "uptime_seconds": 86400
}
```

**`GET /settings/network`**:
```json
{
  "grpc_address": ":7777",
  "rest_address": ":7778",
  "trusted_proxies": ["10.0.0.0/8", "172.16.0.0/12"]
}
```

**`GET /settings/tls`**:
```json
{
  "acme_enabled": true,
  "acme_ca": "https://acme-v02.api.letsencrypt.org/directory",
  "acme_email": "admin@example.com",
  "min_tls_version": "1.2",
  "certificates": [
    {"domain": "*.example.com", "issuer": "Let's Encrypt", "expires_at": "2026-07-12T00:00:00Z"}
  ]
}
```

**`GET /settings/observability`**:
```json
{
  "trace_sampling_rate": 0.1,
  "trace_retention_hours": 168
}
```

**`GET /settings/authentication`**:
```json
{
  "session_duration_hours": 12,
  "password_min_length": 12,
  "password_require_uppercase": true,
  "password_require_number": true,
  "password_require_special": true,
  "lockout_threshold": 5,
  "lockout_duration_minutes": 30
}
```

**`GET /settings/config-store`**:
```json
{
  "backend": "sqlite",
  "path": "/var/lib/rioku/rioku.db",
  "healthy": true,
  "migration_version": 4,
  "migration_dirty": false
}
```

**`GET /settings/pki`**:
```json
{
  "ca_initialized": true,
  "ca_subject": "Rioku Internal CA",
  "ca_expires_at": "2036-04-12T00:00:00Z",
  "last_rotation": "2026-04-01T00:00:00Z",
  "certificates_issued": 3
}
```

### PATCH Behavior

1. Read current `rioku.yaml` into struct
2. Apply PATCH fields (merge, not replace)
3. Validate the merged config
4. Write updated struct back to `rioku.yaml`
5. Trigger config reload (signal the daemon to re-read the file)
6. Return the updated settings section in the response

### Files to modify

- **`packages/daemon/internal/gateway/settings_routes.go`** (new) — All settings handlers, route registration
- **`packages/daemon/internal/config/file.go`** — Read/write helpers for `rioku.yaml` sections, reload trigger
- **`packages/daemon/internal/gateway/settings_routes_test.go`** (new) — Integration tests

---

## #81 — Traffic Dashboard & Per-Entity Analytics

### Overview

New REST handlers that query the existing TraceStore to power the admin panel traffic dashboard. Response shapes match what the frontend mock-fallback currently returns.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/traffic/dashboard?range=24h` | Stat cards + time series for overall traffic |
| `GET` | `/traffic/routes/:id?range=24h` | Per-route stats and time series |
| `GET` | `/traffic/services/:id?range=24h` | Per-service stats and time series |

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `range` | string | `24h` | Time range: `1h`, `6h`, `24h`, `7d`, `30d` |

### Response Shapes

**`GET /traffic/dashboard?range=24h`**:
```json
{
  "stat_cards": {
    "total_requests": 145832,
    "avg_latency_ms": 42,
    "error_rate": 0.023,
    "active_routes": 12,
    "active_services": 5,
    "requests_per_second": 1.68
  },
  "time_series": [
    {
      "timestamp": "2026-04-12T00:00:00Z",
      "requests": 5420,
      "avg_latency_ms": 38,
      "error_count": 120,
      "p50_latency_ms": 25,
      "p95_latency_ms": 95,
      "p99_latency_ms": 210
    }
  ],
  "top_routes": [
    {"id": "route-uuid", "name": "/api/v1/users", "requests": 45000, "avg_latency_ms": 35, "error_rate": 0.01}
  ],
  "top_errors": [
    {"status_code": 502, "count": 234, "route_name": "/api/v1/payments"}
  ],
  "range": "24h"
}
```

**`GET /traffic/routes/:id?range=24h`**:
```json
{
  "route_id": "uuid",
  "route_name": "/api/v1/users",
  "stat_cards": {
    "total_requests": 45000,
    "avg_latency_ms": 35,
    "error_rate": 0.01,
    "requests_per_second": 0.52
  },
  "time_series": [
    {
      "timestamp": "2026-04-12T00:00:00Z",
      "requests": 1800,
      "avg_latency_ms": 32,
      "error_count": 18,
      "p50_latency_ms": 22,
      "p95_latency_ms": 80,
      "p99_latency_ms": 190
    }
  ],
  "status_distribution": {
    "2xx": 44550,
    "3xx": 0,
    "4xx": 200,
    "5xx": 250
  },
  "range": "24h"
}
```

**`GET /traffic/services/:id?range=24h`**:
```json
{
  "service_id": "uuid",
  "service_name": "user-service",
  "stat_cards": {
    "total_requests": 45000,
    "avg_latency_ms": 35,
    "error_rate": 0.01,
    "healthy_upstreams": 3,
    "total_upstreams": 3
  },
  "time_series": [
    {
      "timestamp": "2026-04-12T00:00:00Z",
      "requests": 1800,
      "avg_latency_ms": 32,
      "error_count": 18
    }
  ],
  "upstream_stats": [
    {"address": "10.0.0.1:8080", "requests": 15000, "avg_latency_ms": 33, "error_rate": 0.005, "healthy": true},
    {"address": "10.0.0.2:8080", "requests": 15000, "avg_latency_ms": 36, "error_rate": 0.012, "healthy": true},
    {"address": "10.0.0.3:8080", "requests": 15000, "avg_latency_ms": 37, "error_rate": 0.013, "healthy": true}
  ],
  "range": "24h"
}
```

### TraceStore Queries

The handlers query the existing TraceStore methods:

- `GetStatsBuckets(ctx, start, end, interval)` — returns bucketed stats for time series
- `QueryTraces(ctx, filter)` — filter by `route_id` or `service_id` for per-entity views
- Aggregation (total, avg, percentiles, error rate) is computed in the handler from the returned data

Time range to interval mapping:

| Range | Bucket interval | Max buckets |
|-------|----------------|-------------|
| `1h` | `1m` | 60 |
| `6h` | `5m` | 72 |
| `24h` | `15m` | 96 |
| `7d` | `1h` | 168 |
| `30d` | `6h` | 120 |

### Files to modify

- **`packages/daemon/internal/gateway/traffic_routes.go`** (new) — Dashboard, per-route, and per-service handlers
- **`packages/daemon/internal/gateway/traffic_routes_test.go`** (new) — Integration tests
- **`packages/daemon/internal/gateway/router.go`** — Register traffic routes

---

## Testing Strategy

All tests use real databases (no mocks), table-driven style, run with `-race`.

### #130 — CI multi-backend

| Test | What it validates |
|------|-------------------|
| All existing store tests | Pass on sqlite, postgres, and mariadb |
| CI matrix | Each backend runs in its own CI job |

### #123 — Graceful degradation

| Test | What it validates |
|------|-------------------|
| `TestEngine_CacheFallback_Read` | Store goes offline, read returns cached snapshot |
| `TestEngine_CacheFallback_Write` | Store goes offline, write returns 503 |
| `TestEngine_CacheFallback_NoCache` | Store offline with no cache, read returns 503 |
| `TestEngine_CacheUpdate` | Successful store read updates cache |
| `TestHealth_Degraded` | Health endpoint returns degraded when store offline but cache populated |
| `TestHealth_Unhealthy` | Health endpoint returns unhealthy when store offline and no cache |

### #79 — User & role API

| Test | What it validates |
|------|-------------------|
| `TestListUsers_Success` | Returns JSON array with pagination |
| `TestListUsers_Unauthorized` | Returns 401 without valid auth |
| `TestGetUser_NotFound` | Returns 404 for unknown ID |
| `TestCreateUser_Validation` | Returns 400 for invalid input |
| `TestListUserSessions` | Returns sessions for authenticated user |
| `TestListRoles_WithPermissions` | Roles include expanded permission rules |
| `TestCreateRole_DuplicateName` | Returns 409 for duplicate role name |

### #78 — Settings

| Test | What it validates |
|------|-------------------|
| `TestGetSettings_General` | Returns instance name, log level, versions |
| `TestGetSettings_AllEndpoints` | All 7 GET endpoints return 200 with correct shape |
| `TestPatchSettings_General` | Updates instance name, persists to file |
| `TestPatchSettings_Reload` | PATCH triggers config reload |
| `TestPatchSettings_Validation` | Invalid log level returns 400 |
| `TestGetSettings_ConfigStore` | Returns backend type, health, migration info |
| `TestPatchSettings_ReadOnly` | PATCH to read-only endpoint returns 405 |

### #81 — Traffic dashboard

| Test | What it validates |
|------|-------------------|
| `TestTrafficDashboard_Default` | Returns stat cards + time series for 24h |
| `TestTrafficDashboard_Ranges` | All range values produce correct bucket intervals |
| `TestTrafficDashboard_InvalidRange` | Returns 400 for unsupported range |
| `TestTrafficRoute_Found` | Returns per-route stats with status distribution |
| `TestTrafficRoute_NotFound` | Returns 404 for unknown route ID |
| `TestTrafficService_Found` | Returns per-service stats with upstream breakdown |
| `TestTrafficDashboard_Empty` | No traces returns zero-value stat cards and empty time series |

### Integration / sandbox

- Sandbox smoke test: hit all new endpoints with seeded data, verify 200 responses
- Sandbox smoke test: stop the database, verify degraded behavior on reads and 503 on writes

---

## Acceptance Criteria

### #130 — CI multi-backend
- [ ] All store tests pass on SQLite
- [ ] All store tests pass on PostgreSQL 16
- [ ] All store tests pass on MariaDB 11
- [ ] CI matrix runs all three backends on every PR

### #123 — Graceful degradation
- [ ] Store goes offline with populated cache: read operations return cached data
- [ ] Store goes offline: write operations return 503
- [ ] Health endpoint reports `"status": "degraded"` when store is offline but cache is populated
- [ ] Health endpoint reports `"status": "unhealthy"` when store is offline and no cache exists
- [ ] Caddy continues serving traffic regardless of store state
- [ ] TraceStore continues collecting traces regardless of config store state

### #79 — User & role API
- [ ] `GET /auth/users` returns paginated user list with roles, status, and MFA fields
- [ ] `GET /auth/users/:id/sessions` returns active sessions for the user
- [ ] `GET /auth/roles` returns roles with expanded permission rules
- [ ] `GET /auth/roles/:id` returns single role with permissions and user count
- [ ] All CRUD operations work end-to-end
- [ ] Unauthorized requests return 401

### #78 — Settings
- [ ] All 7 `GET /settings/*` endpoints return current configuration with correct shapes
- [ ] `PATCH /settings/general` updates instance name and log level, persists to file
- [ ] `PATCH /settings/network` updates listen addresses, persists to file
- [ ] `PATCH /settings/observability` updates trace config, persists to file
- [ ] `PATCH /settings/authentication` updates auth config, persists to file
- [ ] PATCH triggers a config reload (daemon re-reads `rioku.yaml`)
- [ ] Read-only endpoints (`tls`, `config-store`, `pki`) reject PATCH with 405

### #81 — Traffic dashboard
- [ ] `GET /traffic/dashboard?range=24h` returns stat cards and time series
- [ ] `GET /traffic/routes/:id?range=24h` returns per-route stats with status distribution
- [ ] `GET /traffic/services/:id?range=24h` returns per-service stats with upstream breakdown
- [ ] All range values (`1h`, `6h`, `24h`, `7d`, `30d`) produce correct bucket intervals
- [ ] Response shapes match what the frontend mock-fallback expects
- [ ] Frontend mock-fallbacks are bypassed when real endpoints return 200
- [ ] Empty TraceStore returns zero-value stat cards and empty arrays (not errors)
