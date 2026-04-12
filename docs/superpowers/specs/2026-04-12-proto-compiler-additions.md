# Proto & Compiler Additions: Proxy Timeouts and Security Headers

**Date**: 2026-04-12
**Scope**: Two compiler features — proxy timeout fields (#68) and HTTP security headers (#118)

---

## Feature 1: Proxy Timeouts (#68)

### Overview

Add three timeout fields to the Service proto message. The Caddy compiler maps them to the `reverse_proxy` transport configuration. The store persists them as duration strings.

### Proto Changes

In `packages/proto/rioku/v1/config.proto`, add to the `Service` message:

```proto
message Service {
  // ... existing fields ...
  google.protobuf.Duration dial_timeout = 10;
  google.protobuf.Duration response_header_timeout = 11;
  google.protobuf.Duration idle_timeout = 12;
}
```

Import `google/protobuf/duration.proto` at the top of the file if not already imported.

### Compiler Mapping

In `packages/daemon/internal/caddy/compiler.go`, when building the `reverse_proxy` handler for a service, emit the `transport` block with timeout values when any timeout is set:

```json
{
  "handler": "reverse_proxy",
  "upstreams": [...],
  "transport": {
    "protocol": "http",
    "dial_timeout": "5s",
    "response_header_timeout": "30s",
    "idle_conn_timeout": "120s"
  }
}
```

Field mapping:

| Proto field | Caddy transport field | Default (when unset) |
|-------------|----------------------|---------------------|
| `dial_timeout` | `dial_timeout` | Caddy default (no explicit value emitted) |
| `response_header_timeout` | `response_header_timeout` | Caddy default |
| `idle_timeout` | `idle_conn_timeout` | Caddy default |

When a timeout field is zero/nil, omit it from the Caddy JSON entirely (let Caddy use its built-in default). Only emit the `transport` block if at least one timeout is set.

### Store Changes

**Migration `000005`** across all three dialects:

- **`packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.up.sql`**
  ```sql
  ALTER TABLE services ADD COLUMN dial_timeout TEXT DEFAULT '';
  ALTER TABLE services ADD COLUMN response_header_timeout TEXT DEFAULT '';
  ALTER TABLE services ADD COLUMN idle_timeout TEXT DEFAULT '';
  ```

- **`packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.up.sql`**
  ```sql
  ALTER TABLE services ADD COLUMN dial_timeout TEXT DEFAULT '';
  ALTER TABLE services ADD COLUMN response_header_timeout TEXT DEFAULT '';
  ALTER TABLE services ADD COLUMN idle_timeout TEXT DEFAULT '';
  ```

- **`packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.up.sql`**
  ```sql
  ALTER TABLE services ADD COLUMN dial_timeout VARCHAR(32) DEFAULT '';
  ALTER TABLE services ADD COLUMN response_header_timeout VARCHAR(32) DEFAULT '';
  ALTER TABLE services ADD COLUMN idle_timeout VARCHAR(32) DEFAULT '';
  ```

Down migrations drop the three columns.

Duration values are stored as Go duration strings (e.g., `"5s"`, `"30s"`, `"2m"`). Empty string means unset.

### Store Driver Changes

In all three drivers (`sqlite.go`, `postgres.go`, `mysql.go`):

- `CreateService()` / `UpdateService()`: persist the three timeout fields
- `scanService()`: read the three timeout columns and parse into `time.Duration` (or the proto `Duration` equivalent)
- `GetService()` / `ListServices()`: timeout fields populated on returned structs

---

## Feature 2: HTTP Security Headers (#118)

### Overview

Inject a `headers` handler at the top of each compiled route chain. Headers are configurable via `rioku.yaml`. The compiler reads the config and emits the appropriate Caddy handler.

### Configuration

In `packages/daemon/internal/config/file.go`, add the `SecurityHeaders` struct:

```go
type SecurityHeaders struct {
    Enabled              bool   `yaml:"enabled"`
    XContentTypeOptions  string `yaml:"x_content_type_options"`
    XFrameOptions        string `yaml:"x_frame_options"`
    ReferrerPolicy       string `yaml:"referrer_policy"`
    PermissionsPolicy    string `yaml:"permissions_policy"`
    CSP                  string `yaml:"csp"`
    HSTS                 HSTSConfig `yaml:"hsts"`
}

type HSTSConfig struct {
    Enabled           bool  `yaml:"enabled"`
    MaxAge            int   `yaml:"max_age"`
    IncludeSubdomains bool  `yaml:"include_subdomains"`
}
```

Default `rioku.yaml` values:

```yaml
security_headers:
  enabled: true
  x_content_type_options: nosniff
  x_frame_options: DENY
  referrer_policy: strict-origin-when-cross-origin
  permissions_policy: "camera=(), microphone=(), geolocation=()"
  hsts:
    enabled: true
    max_age: 63072000
    include_subdomains: true
  csp: ""
```

### Compiler Integration

In `packages/daemon/internal/caddy/compiler.go`, when building a route's handler chain:

1. If `security_headers.enabled` is `false`, skip entirely
2. Build a Caddy `headers` handler with `response > set` entries:
   - `X-Content-Type-Options` from `x_content_type_options` (skip if empty)
   - `X-Frame-Options` from `x_frame_options` (skip if empty)
   - `Referrer-Policy` from `referrer_policy` (skip if empty)
   - `Permissions-Policy` from `permissions_policy` (skip if empty)
   - `Content-Security-Policy` from `csp` (skip if empty)
   - `Strict-Transport-Security` from HSTS config (only when HSTS enabled AND the route/server uses TLS)
3. Insert the headers handler as the first handler in the route chain (before auth, rate limiting, reverse_proxy)

HSTS header value format: `max-age=63072000; includeSubDomains` (omit `includeSubDomains` directive if `include_subdomains` is false).

Individual headers are disabled by setting their value to empty string in config. The entire feature is disabled by setting `enabled: false`.

### Caddy JSON Output

Example compiled route with security headers:

```json
{
  "handle": [
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
      "handler": "reverse_proxy",
      "upstreams": [...]
    }
  ]
}
```

---

## Files to Modify

### Proto

- **`packages/proto/rioku/v1/config.proto`** — Add `dial_timeout`, `response_header_timeout`, `idle_timeout` to `Service` message. Add `google.protobuf.Duration` import if missing. Run `make proto` after changes.

### Compiler

- **`packages/daemon/internal/caddy/compiler.go`**
  - Timeout mapping: in the function that builds `reverse_proxy` handlers, emit `transport` block with timeouts when set
  - Security headers: new function `buildSecurityHeadersHandler(cfg SecurityHeaders, tlsActive bool) map[string]any` that returns the Caddy headers handler JSON structure
  - Insert security headers handler at position 0 in each route's handler chain

### Config

- **`packages/daemon/internal/config/file.go`** — Add `SecurityHeaders` and `HSTSConfig` structs. Add `SecurityHeaders` field to the top-level config struct.

### Store migrations

- **`packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.up.sql`**
- **`packages/daemon/internal/store/migrations/sqlite/000005_service_timeouts.down.sql`**
- **`packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.up.sql`**
- **`packages/daemon/internal/store/migrations/postgres/000005_service_timeouts.down.sql`**
- **`packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.up.sql`**
- **`packages/daemon/internal/store/migrations/mysql/000005_service_timeouts.down.sql`**

### Store drivers

- **`packages/daemon/internal/store/sqlite/sqlite.go`** — Persist and read timeout fields in service CRUD + `scanService()`
- **`packages/daemon/internal/store/postgres/postgres.go`** — Same
- **`packages/daemon/internal/store/mysql/mysql.go`** — Same

### Tests

- **`packages/daemon/internal/caddy/compiler_test.go`**
  - Timeout tests
  - Security header tests

---

## Testing Strategy

All tests table-driven, run with `-race`.

### Timeout tests (`compiler_test.go`)

| Test | Input | Expected output |
|------|-------|-----------------|
| `TestCompiler_ServiceWithAllTimeouts` | Service with all three timeouts set | `transport` block with all three values |
| `TestCompiler_ServiceWithPartialTimeouts` | Service with only `dial_timeout` | `transport` block with only `dial_timeout` |
| `TestCompiler_ServiceWithNoTimeouts` | Service with no timeouts | No `transport` block in output |
| `TestStore_ServiceTimeoutRoundTrip` | Create service with timeouts, read back | Values match |

### Security header tests (`compiler_test.go`)

| Test | Input | Expected output |
|------|-------|-----------------|
| `TestCompiler_SecurityHeadersEnabled` | All defaults | Headers handler first in chain with all configured values |
| `TestCompiler_SecurityHeadersDisabled` | `enabled: false` | No headers handler in chain |
| `TestCompiler_SecurityHeadersPartial` | Some headers empty | Only non-empty headers in set |
| `TestCompiler_SecurityHeadersNoCSP` | `csp: ""` | No `Content-Security-Policy` header |
| `TestCompiler_HSTSWithTLS` | HSTS enabled, TLS active | `Strict-Transport-Security` present |
| `TestCompiler_HSTSWithoutTLS` | HSTS enabled, TLS not active | `Strict-Transport-Security` absent |
| `TestCompiler_HSTSNoSubdomains` | `include_subdomains: false` | Header value without `includeSubDomains` |

### Store tests (per driver)

| Test | What it validates |
|------|-------------------|
| `TestMigration_000005` | Migration applies and rolls back cleanly |
| `TestServiceTimeout_RoundTrip` | All three timeout fields survive write/read |
| `TestServiceTimeout_Empty` | Unset timeouts read back as zero values |

---

## Acceptance Criteria

- [ ] Service with timeouts configured produces Caddy transport JSON with correct timeout values
- [ ] Service without timeouts produces no explicit transport timeout values (Caddy defaults apply)
- [ ] Partial timeout configuration (e.g., only `dial_timeout`) only emits that field
- [ ] Security headers appear on all compiled routes when `security_headers.enabled` is `true`
- [ ] Security headers handler is first in the route handler chain
- [ ] Individual headers can be disabled by setting to empty string
- [ ] Setting `security_headers.enabled: false` removes all security headers from compiled output
- [ ] HSTS header only emitted when TLS is active on the route/server
- [ ] HSTS `includeSubDomains` directive controlled by config flag
- [ ] CSP header only emitted when `csp` is non-empty
- [ ] Timeout fields round-trip through all three store backends
- [ ] Migration 000005 applies and rolls back cleanly on all three backends
- [ ] `make proto` succeeds with the new fields
- [ ] All existing compiler tests pass without modification
- [ ] All existing store tests pass without modification
- [ ] New tests cover every scenario listed above
- [ ] Tests pass with `-race` flag
