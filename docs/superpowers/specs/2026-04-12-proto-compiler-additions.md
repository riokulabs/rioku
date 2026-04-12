# Proto & Compiler Additions: Proxy Timeouts and Security Headers

**Date**: 2026-04-12 (revised)
**Scope**: Two compiler features -- proxy timeout fields (#68) and HTTP security headers (#118)

---

## Feature 1: Proxy Timeouts (#68)

### Overview

Add three timeout fields to the Service proto message using `int32` seconds fields (matching the existing `HealthCheck` pattern in `config.proto`). The Caddy compiler maps them to the `reverse_proxy` transport configuration. The store persists them as integer columns.

### Proto Changes

In `packages/proto/rioku/v1/config.proto`, add to the `Service` message after field 8 (`updated_at`):

```proto
message Service {
  // ... existing fields 1-8 ...
  int32 dial_timeout_seconds             = 9;
  int32 response_header_timeout_seconds  = 10;
  int32 idle_timeout_seconds             = 11;
}
```

**Field numbering note**: Field 8 is `updated_at`, so new fields start at 9. Protobuf best practice (per protobuf.dev): "Assign numbers densely and sequentially. Gaps should only occur when a previously used field is removed."

**Rationale for `int32` seconds**: The existing `HealthCheck` message uses `int32 interval_seconds`, `int32 timeout_seconds`, etc. (lines 88-94 of `config.proto`). Using the same pattern keeps the proto API consistent and avoids adding a `google.protobuf.Duration` import and the complexity of Duration serialization in stores. Sub-second proxy timeouts are not a realistic use case.

### Compiler Mapping

In `packages/daemon/internal/caddy/compiler.go`, in the `applyService` function (line 327), after setting upstreams, load balancing, and health checks, emit a `transport` block when any timeout is set.

Caddy's `reverse_proxy` transport uses the `http` protocol module. The correct JSON field names for the HTTP transport (verified from Caddy's `HTTPTransport` struct at pkg.go.dev and caddyserver.com/docs/modules/http.reverse_proxy.transport.http) are:

| Proto field | Caddy transport JSON field | Caddy docs reference |
|---|---|---|
| `dial_timeout_seconds` | `dial_timeout` | Top-level transport field (`caddy.Duration`, default `"3s"`) |
| `response_header_timeout_seconds` | `response_header_timeout` | Top-level transport field (`caddy.Duration`, no default) |
| `idle_timeout_seconds` | `keep_alive.idle_conn_timeout` | **Nested** under `keep_alive` sub-object, NOT at transport root |

**Important**: Caddy's `idle_conn_timeout` is nested inside the `keep_alive` sub-object of the HTTP transport, not at the transport root level. The compiler must emit this as a nested structure. `dial_timeout` and `response_header_timeout` are top-level transport fields.

When a timeout field is 0 (the proto3 default), omit it from the Caddy JSON (let Caddy use its built-in default). Only emit the `transport` block if at least one timeout is non-zero. Only emit the `keep_alive` sub-object if `idle_timeout_seconds` is non-zero.

Example compiled output:

```json
{
  "handler": "reverse_proxy",
  "upstreams": [...],
  "transport": {
    "protocol": "http",
    "dial_timeout": "5s",
    "response_header_timeout": "30s",
    "keep_alive": {
      "idle_conn_timeout": "120s"
    }
  }
}
```

### Store Changes

**Migration numbering**: SQLite is at migration 000004 (TOTP backup codes). Postgres and MySQL are missing 000001 (initial schema) -- they start at 000002. The new timeout migration is **000005** across all three dialects.

**Note on postgres/mysql**: The postgres and mysql driver packages are empty stubs (package declaration only, no code). Writing migration SQL files for them is cheap and keeps version numbers synchronized, but the actual driver code to read/write these columns does not exist and is out of scope. The migration files should still be created so that when those drivers are implemented, the schema is ready.

**`packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.up.sql`**:
```sql
ALTER TABLE services ADD COLUMN dial_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN response_header_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN idle_timeout_seconds INTEGER NOT NULL DEFAULT 0;
```

**`packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.up.sql`**:
```sql
ALTER TABLE services ADD COLUMN dial_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN response_header_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN idle_timeout_seconds INTEGER NOT NULL DEFAULT 0;
```

**`packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.up.sql`**:
```sql
ALTER TABLE services ADD COLUMN dial_timeout_seconds INT NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN response_header_timeout_seconds INT NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN idle_timeout_seconds INT NOT NULL DEFAULT 0;
```

Down migrations drop the three columns (all three dialects).

Values are stored as integers (seconds). 0 means unset/use Caddy defaults.

### Store Driver Changes

**sqlite driver** (`packages/daemon/internal/store/sqlite/sqlite.go`):
- `CreateService()` (line 402): add the three timeout columns to the INSERT statement
- `UpdateService()` (line 527): add the three timeout columns to the UPDATE statement
- `scanService()` (line 1797): scan the three additional columns and set them on the proto Service
- `GetService()` / `ListServices()`: no changes needed beyond `scanService` -- the SELECT queries need the new columns added

**raft driver** (`packages/daemon/internal/store/raft/tx.go`):
- The raft driver stores services as full protojson blobs. Adding fields to the proto Service message means they are automatically included in `protojson.Marshal`/`protojson.Unmarshal`. No raft driver code changes needed for timeout persistence -- it comes for free with protojson.

**postgres/mysql drivers**: Out of scope (empty stubs).

### Migration Registration

In `sqlite.go` `migrateUp()` (line 103), add a block for migration 5:

```go
if current < 5 {
    data, err := store.MigrationFS.ReadFile("migrations/sqlite/000005_service_timeouts.up.sql")
    // ... same pattern as migrations 1-4
}
```

---

## Feature 2: HTTP Security Headers (#118)

### Overview

Inject a Caddy `headers` handler into each compiled **traffic** route's handler chain. Headers are configurable via `rioku.yaml`. The compiler reads the config and emits the appropriate Caddy handler. The admin server block is **excluded** -- it has its own CSP needs (inline scripts for the SPA) that conflict with strict traffic headers.

**Relationship to existing security middleware**: `internal/gateway/security_middleware.go` already sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a CSP on the Go HTTP admin/REST API response path. The NEW Caddy-level security headers specified here apply to **proxied traffic only** (different response path -- Caddy reverse proxy routes, not the Go gateway). These two layers do not conflict: the Go middleware covers admin/REST API responses, while the Caddy headers handler covers traffic routed through the reverse proxy. Both should be maintained independently.

### Configuration

In `packages/daemon/internal/config/file.go`, add to the `Config` struct:

```go
type Config struct {
    // ... existing fields ...
    SecurityHeaders SecurityHeaders `yaml:"security_headers"`
}
```

New structs:

```go
type SecurityHeaders struct {
    Enabled             bool       `yaml:"enabled"`
    XContentTypeOptions string     `yaml:"x_content_type_options"`
    XFrameOptions       string     `yaml:"x_frame_options"`
    ReferrerPolicy      string     `yaml:"referrer_policy"`
    PermissionsPolicy   string     `yaml:"permissions_policy"`
    CSP                 string     `yaml:"csp"`
    CSPReportOnly       bool       `yaml:"csp_report_only"`
    HSTS                HSTSConfig `yaml:"hsts"`
}

type HSTSConfig struct {
    Enabled           bool `yaml:"enabled"`
    MaxAge            int  `yaml:"max_age"`
    IncludeSubdomains bool `yaml:"include_subdomains"`
}
```

Defaults (in the `Default()` function):

```go
SecurityHeaders: SecurityHeaders{
    Enabled:             true,
    XContentTypeOptions: "nosniff",
    XFrameOptions:       "DENY",
    ReferrerPolicy:      "strict-origin-when-cross-origin",
    PermissionsPolicy:   "camera=(), microphone=(), geolocation=()",
    CSP:                 "",
    HSTS: HSTSConfig{
        Enabled:           true,
        MaxAge:            63072000, // 2 years
        IncludeSubdomains: true,
    },
},
```

**CSP best practice note**: Per OWASP 2026 guidance, Content-Security-Policy should be rolled out in Report-Only mode first before enforcing. When `csp` is non-empty, the `csp_report_only` option controls which header is emitted:

- `csp_report_only: true` -- emits `Content-Security-Policy-Report-Only` (monitors violations without blocking)
- `csp_report_only: false` (default) -- emits `Content-Security-Policy` (enforcing mode)

This allows operators to deploy CSP incrementally: start with report-only to identify violations, then switch to enforcing once the policy is validated.

### Compiler Integration

In `packages/daemon/internal/caddy/compiler.go`:

**Handler chain position**: The security headers handler goes at position **1** (after the tracing handler, before the vars handler). The current handler chain in `CompileRoute` (line 197) is:

```go
caddyRoute["handle"] = []map[string]any{tracingHandler, varsHandler, handler}
```

The new chain becomes:

```go
caddyRoute["handle"] = []map[string]any{tracingHandler, securityHeadersHandler, varsHandler, handler}
```

Tracing must remain first so the trace ID is available to all subsequent handlers. Security headers go next because they apply unconditionally to all responses.

**Traffic routes only**: The security headers handler is only inserted into routes compiled by `CompileRoute` (which builds the traffic server block routes). The admin server block (built by `buildAdminServer` at line 384) does **not** get security headers. The admin panel SPA requires a permissive CSP for inline scripts and styles, which conflicts with strict security headers. Admin panel CSP is a separate concern to be addressed when the SPA build pipeline is finalized.

**HSTS TLS detection**: HSTS should only be emitted when TLS is active. The compiler already has `hasStandardPorts()` (line 426) which returns true when traffic addresses include `:443` or `:80`. Use this: emit HSTS only when `hasStandardPorts()` returns true OR when `AdminConfig.Domain` is set (which forces `:443`). When running on non-standard ports (e.g., `:8443` in dev), HSTS is suppressed to avoid poisoning browsers with HSTS for development domains.

**Implementation**:

1. Add a new method: `func (c *Compiler) buildSecurityHeadersHandler(cfg SecurityHeaders) map[string]any`
2. If `cfg.Enabled` is false, return nil (caller skips insertion)
3. Build the `response.set` map, only including headers with non-empty values
4. For HSTS: only include if `cfg.HSTS.Enabled` AND `c.hasStandardPorts()` is true
5. HSTS value format: `max-age=63072000; includeSubDomains` (omit `includeSubDomains` when `cfg.HSTS.IncludeSubdomains` is false)
6. If the resulting `set` map is empty (all headers disabled), return nil

**CORS interaction**: The CORS middleware is applied at the Go gateway level (`CORSMiddleware` in `gateway.go` line 128), not in Caddy. The security headers are applied in Caddy at the traffic route level. These two layers do not conflict because:
- CORS headers (`Access-Control-Allow-Origin`, etc.) are set by the Go middleware on the admin/REST API responses
- Security headers (`X-Frame-Options`, `HSTS`, etc.) are set by Caddy on proxied traffic responses
- They operate on different server blocks and different response paths

### Caddy JSON Output

Example compiled route with security headers enabled:

```json
{
  "match": [...],
  "handle": [
    {
      "handler": "tracing",
      "span": "rioku"
    },
    {
      "handler": "headers",
      "response": {
        "set": {
          "X-Content-Type-Options": ["nosniff"],
          "X-Frame-Options": ["DENY"],
          "Referrer-Policy": ["strict-origin-when-cross-origin"],
          "Permissions-Policy": ["camera=(), microphone=(), geolocation=()"],
          "Strict-Transport-Security": ["max-age=63072000; includeSubDomains"]
        }
      }
    },
    {
      "handler": "vars",
      "rioku_route_id": "...",
      "rioku_service_id": "..."
    },
    {
      "handler": "reverse_proxy",
      "upstreams": [...]
    }
  ]
}
```

---

## Files to Modify

### Proto

- **`packages/proto/rioku/v1/config.proto`** -- Add `dial_timeout_seconds`, `response_header_timeout_seconds`, `idle_timeout_seconds` to `Service` message (fields 9-11). Run `make proto` after.

### Compiler

- **`packages/daemon/internal/caddy/compiler.go`**
  - `applyService`: emit `transport` block with timeout duration strings when any timeout > 0
  - New `buildSecurityHeadersHandler` method on `Compiler`
  - `CompileRoute`: insert security headers handler at position 1 when enabled
  - `NewCompiler`: accept `SecurityHeaders` config specifically (not the full `*config.Config` -- follows the existing pattern where `NewCompiler` takes specific configs rather than the entire config struct)

### Config

- **`packages/daemon/internal/config/file.go`**
  - Add `SecurityHeaders` and `HSTSConfig` structs
  - Add `SecurityHeaders` field to `Config` struct
  - Set defaults in `Default()`
  - No changes to `applyDefaults()` or `validate()` needed (struct fields have sensible zero values)

### Store migrations

- **`packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.up.sql`** (new)
- **`packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.down.sql`** (new)
- **`packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.up.sql`** (new)
- **`packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.down.sql`** (new)
- **`packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.up.sql`** (new)
- **`packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.down.sql`** (new)

### Store drivers

- **`packages/daemon/internal/store/sqlite/sqlite.go`** -- Add timeout columns to `CreateService`, `UpdateService`, `scanService`, and SELECT queries in `GetService`/`ListServices`. Register migration 5 in `migrateUp`/`migrateDown`.
- **`packages/daemon/internal/store/raft/`** -- No changes needed (protojson handles new fields automatically)
- **`packages/daemon/internal/store/postgres/`** -- Out of scope (empty stub)
- **`packages/daemon/internal/store/mysql/`** -- Out of scope (empty stub)

### Tests

- **`packages/daemon/internal/caddy/compiler_test.go`** -- Timeout and security header tests
- **`packages/daemon/internal/store/sqlite/sqlite_test.go`** -- Timeout round-trip tests

---

## Testing Strategy

All tests table-driven, run with `-race`.

### Timeout tests (`compiler_test.go`)

| Test | Input | Expected output |
|------|-------|-----------------|
| `TestCompiler_ServiceWithAllTimeouts` | Service with all three timeouts set | `transport` block with `dial_timeout`, `response_header_timeout`, and `keep_alive.idle_conn_timeout` |
| `TestCompiler_ServiceWithPartialTimeouts` | Service with only `dial_timeout_seconds=5` | `transport` block with only `dial_timeout: "5s"` |
| `TestCompiler_ServiceWithNoTimeouts` | Service with all timeouts = 0 | No `transport` block in output |
| `TestCompiler_TimeoutFormatting` | Various timeout values | Duration strings formatted correctly (e.g., 120 -> "120s") |

### Security header tests (`compiler_test.go`)

| Test | Input | Expected output |
|------|-------|-----------------|
| `TestCompiler_SecurityHeadersAllDefaults` | Default SecurityHeaders config | Headers handler at position 1 with all default values |
| `TestCompiler_SecurityHeadersDisabled` | `Enabled: false` | No headers handler in chain |
| `TestCompiler_SecurityHeadersPartialEmpty` | Some header values set to `""` | Only non-empty headers in `response.set` |
| `TestCompiler_SecurityHeadersNoCSP` | `CSP: ""` (default) | No `Content-Security-Policy` key in set |
| `TestCompiler_SecurityHeadersWithCSP` | `CSP: "default-src 'self'"`, `CSPReportOnly: false` | `Content-Security-Policy` present |
| `TestCompiler_SecurityHeadersWithCSPReportOnly` | `CSP: "default-src 'self'"`, `CSPReportOnly: true` | `Content-Security-Policy-Report-Only` present (not `Content-Security-Policy`) |
| `TestCompiler_HSTSWithStandardPorts` | HSTS enabled, traffic on `:443` | `Strict-Transport-Security` present |
| `TestCompiler_HSTSWithNonStandardPorts` | HSTS enabled, traffic on `:8443` | `Strict-Transport-Security` absent |
| `TestCompiler_HSTSDisabled` | `HSTS.Enabled: false` | `Strict-Transport-Security` absent |
| `TestCompiler_HSTSNoSubdomains` | `IncludeSubdomains: false` | Header value without `includeSubDomains` directive |
| `TestCompiler_SecurityHeadersNotOnAdmin` | Full config with admin server | Admin server block has no headers handler |
| `TestCompiler_AllHeadersEmpty` | All individual headers set to `""` | No headers handler inserted (nil return) |

### Store tests (sqlite)

| Test | What it validates |
|------|-------------------|
| `TestMigration_000005_UpDown` | Migration applies and rolls back cleanly |
| `TestServiceTimeout_RoundTrip` | All three timeout fields survive create/read |
| `TestServiceTimeout_Update` | Timeout fields update correctly |
| `TestServiceTimeout_ZeroValues` | Unset timeouts (0) read back as 0, no transport block emitted |

### Combined feature tests (`compiler_test.go`)

| Test | Input | Expected output |
|------|-------|-----------------|
| `TestCompiler_ServiceWithHealthCheckAndTimeouts` | Service with health check config + all three timeouts set | Caddy JSON contains both `health_checks` block and `transport` block with correct fields (ensures both features compose correctly) |

---

## Acceptance Criteria

- [ ] Service with timeouts configured produces Caddy transport JSON with correct field names and duration strings
- [ ] Service without timeouts (all 0) produces no `transport` block (Caddy defaults apply)
- [ ] Partial timeout configuration (e.g., only `dial_timeout_seconds`) only emits that field in transport
- [ ] Security headers handler appears at position 1 (after tracing, before vars) on all compiled traffic routes
- [ ] Security headers are NOT applied to the admin server block
- [ ] Individual headers can be disabled by setting their config value to empty string
- [ ] Setting `security_headers.enabled: false` removes all security headers from compiled output
- [ ] HSTS header only emitted when `hasStandardPorts()` returns true
- [ ] HSTS `includeSubDomains` directive controlled by config flag
- [ ] CSP header only emitted when `csp` is non-empty
- [ ] Timeout fields round-trip through sqlite store (create, read, update, read)
- [ ] Raft driver handles new timeout fields automatically via protojson
- [ ] Migration 000005 applies and rolls back cleanly on sqlite
- [ ] Migration SQL files exist for postgres and mysql (even though drivers are stubs)
- [ ] `make proto` succeeds with the new fields
- [ ] All existing compiler tests pass without modification
- [ ] All existing store tests pass without modification
- [ ] New tests cover every scenario listed above
- [ ] Tests pass with `-race` flag
