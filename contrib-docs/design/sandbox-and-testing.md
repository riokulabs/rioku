# Design: Sandbox Environment & Testing Infrastructure

## Context

Rioku needs a self-contained sandbox environment with realistic upstream applications for manual testing, CLI/admin panel development, and automated testing. The project also needs comprehensive test coverage across all layers: Go unit tests, integration tests, frontend component tests, browser e2e tests, and performance regression testing.

The daemon has ~3,850 lines of existing Go tests across 8 files. The web panel has zero test infrastructure. No Docker, no sandbox, no e2e tests exist today.

## Goals

- Run `make sandbox` and get a fully functional Rioku instance with real routed traffic
- 100% test coverage target across Go and frontend code
- Performance regression detection on every PR
- Four-layer Go testing: unit, integration, sandbox, benchmarks
- Frontend testing: Vitest (unit/component) + Playwright (e2e)
- CI enforcement of all test layers

---

## Part 1: Sandbox Environment

### Sandbox Apps

Five fake upstream services covering different API patterns. Each is a standalone Go binary using stdlib only (no external dependencies, no Go module needed — built with `go build` from the repo root). They live at `sandbox/apps/` outside the daemon module. Configurable via flags, with realistic behavior suitable for load testing.

#### Shared infrastructure (all apps)

- `-port` flag (default per app)
- `-max-conns` flag — simulates connection pool limits, returns 503 when exceeded
- `-error-rate` flag — percentage of requests that return errors (default varies per app)
- `-latency-min`, `-latency-max`, `-latency-p99` flags — tune response latency without recompiling
- `GET /metrics` — Prometheus-compatible text format: total requests, active connections, error count, latency histogram
- `X-Request-ID` propagation — reads from request, includes in response and logs
- Graceful shutdown — signal handling for clean teardown
- Request logging to stdout: timestamp, method, path, status, latency, request ID

#### users (:9001) — REST CRUD with simulated database

~200-250 lines. In-memory store of ~1000 pre-seeded users generated at startup.

| Endpoint | Behavior |
|---|---|
| `GET /users` | Paginated, filterable by name/email, sortable. Latency scales with result size |
| `GET /users/:id` | Single lookup, 2-10ms base latency |
| `POST /users` | Validates payload (name, email required), returns 201 or 422 |
| `PUT /users/:id` | Partial update, returns 200 or 404 |
| `DELETE /users/:id` | Soft delete, returns 204 |

Simulates connection pool: concurrent requests beyond `-max-conns` get queued with backpressure latency added.

#### products (:9002) — Catalog with search and heavy payloads

~250-300 lines. In-memory catalog of ~5000 products with nested categories, image thumbnails (base64), descriptions.

| Endpoint | Behavior |
|---|---|
| `GET /products` | Paginated, category filter. Response bodies 5-50KB depending on page size |
| `GET /products/:id` | Full product detail, ~2-5KB |
| `GET /products/search?q=` | Full-text scan, deliberate O(n) latency that degrades under large catalogs |
| `POST /products` | Create with validation |

Simulates cache behavior: first request for a product is slow (50-100ms "DB hit"), subsequent requests fast (2-5ms "cache hit") via internal LRU. Default error rate ~2%.

#### webhooks (:9003) — Async receiver with backpressure

~200-250 lines. Accepts webhook payloads, queues them in-memory per channel.

| Endpoint | Behavior |
|---|---|
| `POST /hooks/:channel` | Accepts arbitrary JSON, returns 202 Accepted |
| `GET /hooks/:channel/pending` | Returns current queue depth |
| `GET /hooks/:channel/drain` | Flushes queue, returns drained count |

Per-channel queue with configurable depth (`-queue-depth`, default 1000). When full, returns 429. Simulates processing delay: each webhook "processes" asynchronously with configurable latency. Under sustained load, queues fill and start rejecting — realistic backpressure pattern.

#### auth-service (:9004) — Token validation with rate limiting

~200-250 lines. Simulates an upstream authentication dependency.

| Endpoint | Behavior |
|---|---|
| `POST /auth/token` | Accepts `{ "username", "password" }`, returns JWT-like token (base64 JSON with expiry, not real crypto) |
| `GET /auth/validate` | Reads `Authorization: Bearer` header, validates expiry, returns 200 with claims or 401 |
| `POST /auth/refresh` | Accepts refresh token, returns new access token |
| `GET /auth/stats` | Returns failed attempt counts (feeds audit log testing) |

Built-in per-IP sliding window rate limiter, returns 429 when exceeded (`-rate-limit` flag, default 100/s). Token generation slow (10-30ms "bcrypt"), validation fast (1-3ms "cache lookup").

#### media (:9005) — Large responses with streaming

~250-300 lines. Pre-generates random binary blobs at startup (10 items, 50KB-2MB each).

| Endpoint | Behavior |
|---|---|
| `GET /media/:id` | Streams blob with `Content-Length`, supports `Range` header for partial content (206) |
| `POST /media/upload` | Accepts multipart form, stores in memory, returns ID. Validates size limit (`-max-upload`, default 10MB) |
| `GET /media/:id/meta` | Returns metadata (size, type, created) without body |
| `DELETE /media/:id` | Removes from memory |

`-bandwidth-limit` flag throttles response streaming for timeout behavior testing. Under load, large responses create memory pressure — tests Rioku's proxy buffering.

### Seed Configuration

`sandbox/config/seed.json` — Rioku config applied via REST after daemon starts:

**Routes:**
- `api.local/v1/users/*` → users service (round-robin LB)
- `api.local/v1/products/*` → products service (random LB)
- `hooks.local/*` → webhooks service (first LB)
- `auth.local/*` → auth-service (least-conn LB)
- `media.local/*` → media service (first LB)

**Policies:**
- Rate limit on products route (100 req/s)
- Auth check on users route (requires valid token from auth-service)
- CORS allow-all on all routes

**API keys:**
- Bootstrap admin key for sandbox access
- Read-only monitoring key

### Orchestration

**`sandbox/scripts/start.sh`:**
1. Build daemon + all 5 apps (parallel `go build`)
2. Start apps with tuned flags (products: higher error rate; media: bandwidth limit)
3. Start `rioku daemon --dev --data-dir ./sandbox/.data`
4. Health-check all 6 processes (retry with backoff)
5. Seed config via `POST /api/v1/config`
6. Seed API keys via `POST /api/v1/keys`
7. Print summary: all URLs, credentials, PID file location

**`sandbox/scripts/stop.sh`:**
1. Read PIDs from `.data/pids`
2. Send SIGTERM to all processes
3. Wait for graceful shutdown (5s timeout, then SIGKILL)
4. Clean up PID file

**`sandbox/.data/`** — gitignored. Contains SQLite DB, certs, logs, PID files.

### Make Targets

```
make sandbox           — build + start full sandbox environment
make sandbox-stop      — stop all sandbox processes
make sandbox-seed      — re-seed config without restart
make sandbox-load      — run standard load profile against sandbox
make sandbox-load-compare — compare load results against baseline
```

---

## Part 2: Go Testing

### Unit Tests (per-package, 100% coverage target)

Standard library `testing.T`, table-driven, race detector mandatory. Every `internal/` package gets `*_test.go` coverage.

**Coverage gaps to fill:**

| Package | Status | Test Focus |
|---|---|---|
| `auth/` | NEW | Token generation, validation, expiry, refresh, permission scoping |
| `build/` | NEW | Build client request/response, error handling |
| `cache/` | EXPAND (333 lines) | TTL expiry, eviction, memory limits, concurrent access |
| `caddy/` | EXPAND (562 lines) | Config compilation edge cases, invalid configs, reload |
| `cli/` | NEW | Command parsing, flag validation, output formatting |
| `cluster/crdt/` | EXPAND (259 lines) | Conflict resolution, network partition simulation |
| `cluster/` | EXPAND (293 lines) | Join/leave, split-brain, quorum loss |
| `config/` | EXPAND (738 lines) | Concurrent mutations, version conflicts, rollback |
| `daemon/` | NEW | Lifecycle: start, graceful shutdown, signal handling |
| `gateway/` | NEW | REST translation, error mapping, SSE streaming, auth middleware |
| `grpc/` | NEW | Server setup, interceptors, TLS handshake |
| `keyring/` | NEW | Secret storage, rotation, encryption/decryption |
| `mcp/` | NEW | MCP protocol handling |
| `pki/` | NEW | CA operations, cert generation, validation, rotation, expiry |
| `plugin/wasm/` | EXPAND (295 lines) | Malicious WASM, resource limits, timeout |
| `store/sqlite/` | EXPAND (926 lines) | Concurrent writes, WAL mode, large datasets |
| `store/postgres/` | NEW | Full CRUD, migrations, connection pooling |
| `store/mysql/` | NEW | Full CRUD, migrations, Galera compatibility |
| `store/raft/` | EXPAND (445 lines) | Leader election, log compaction, snapshot |
| `sync/` | NEW | Synchronization primitives under contention |
| `tracestore/` | NEW | Trace recording, querying, retention, cleanup |
| `version/` | NEW | Version string formatting |

**Coverage enforcement:** `-coverprofile=coverage.out` on all test runs. CI fails if total coverage drops below baseline. `make test-coverage` generates HTML report. Baseline ratchets up as tests are added.

### Integration Tests (`-tags integration`)

**REST API integration** (`internal/gateway/`):
- Start daemon in-process with test config
- Full auth flow: bootstrap token → login → access token → refresh → expiry → re-login
- Config CRUD round-trips: create route → GET → verify → update → delete
- Service CRUD with upstream validation
- Policy CRUD with attachment/detachment
- API key lifecycle: create → auth with it → revoke → verify rejected
- Audit log: perform mutations → query audit → verify entries (actor, entity, operation, diff)
- SSE streaming: connect → make config change → verify event received within timeout
- Error handling: malformed requests → RFC 7807 responses
- Concurrent mutations: parallel writes → verify consistency (no lost updates)
- Health endpoint: verify subsystem statuses reflect actual state

**Store integration** (per-dialect):
- Full CRUD for all entity types (routes, services, policies, keys, audit entries)
- Migration up/down for all versions
- Concurrent read/write under race detector
- Large dataset behavior (10K routes, 1K services)
- Transaction isolation: read during write
- Connection pool exhaustion and recovery

**CI matrix:**
- SQLite: always runs (no external deps)
- Postgres 17: docker-compose service in CI
- MariaDB 11: docker-compose service in CI

**Cross-store consistency:** Same test suite runs against all 3 backends via interface. Write to store → verify read matches expected. Ensures all dialects behave identically.

### Sandbox Integration Tests (`-tags sandbox`)

**Routing verification:**
- Request to each of 5 routes → correct upstream receives it
- Path matching: exact, prefix, wildcard
- Host matching: different hosts → different services
- Method matching: GET vs POST to same path
- Request/response passthrough: headers, body, status codes preserved
- Load balancing: round-robin distributes across upstreams

**Policy enforcement:**
- Rate limit: send N+1 requests → verify 429 on excess
- Auth policy: no token → 401, valid token → proxied, expired token → 401
- CORS: preflight responses correct, allowed origins enforced

**Config propagation:**
- Add new route via API → requests immediately route correctly
- Disable route → 404
- Change upstream → traffic shifts
- Measure propagation delay (config change → Caddy picks it up)

**Resilience:**
- Kill upstream app → verify 502/503
- Restart upstream → traffic resumes
- Slow upstream (media with bandwidth limit) → timeout behavior

**Admin panel data accuracy (headless via REST):**
- Dashboard data matches seeded config (route count, service count)
- Health endpoint shows all subsystems healthy
- Create route via REST → fetch config → route present

---

## Part 3: Frontend Testing

### Vitest — Unit + Component Tests

**Configuration:** `vitest.config.ts` with `@testing-library/react`, jsdom environment, path aliases matching Vite config.

**Library tests** (`src/lib/__tests__/`):

| File | Tests |
|---|---|
| `api.test.ts` | GET/POST/PUT/DEL, auth header injection, RFC 7807 error parsing, retry behavior, base URL handling |
| `auth.test.ts` | Token storage, setTokens/clearTokens/isAuthenticated, login flow mock, refresh flow, getAuthHeader |
| `preferences.test.ts` | Get/set/reset, localStorage serialization, default values, type safety, invalid stored data |
| `plugin-registry.test.ts` | Register plugin, getNavItems, getRoutes, getDashboardWidgets, getInjections by zone, priority sorting, duplicate registration |
| `plugin-loader.test.ts` | Mock dynamic import, manifest fetch, error handling for bad plugins |
| `i18n.test.ts` | Initialization, namespace loading, fallback behavior, missing keys |
| `utils.test.ts` | cn() merge behavior, edge cases |

**Hook tests** (`src/hooks/__tests__/`):

| File | Tests |
|---|---|
| `use-auth.test.ts` | AuthProvider renders, login/logout transitions, 401 event handling, refresh on mount, context missing error |
| `use-theme.test.ts` | Theme toggle, system preference detection, persistence to preferences, dark class on `<html>` |
| `use-hotkeys.test.ts` | Key registration, platform detection (Mod mapping), callback invocation, cleanup on unmount, ignores form field inputs |
| `use-sse.test.ts` | Connection lifecycle, reconnect with backoff, data parsing, cleanup on unmount, enabled/disabled toggle |
| `use-mobile.test.ts` | Breakpoint detection via mock matchMedia |

**Component tests** (`src/components/rioku/__tests__/`):

| File | Tests |
|---|---|
| `stat-card.test.tsx` | Renders title/value/icon, trend up/down styling, no trend case, className passthrough |
| `data-table.test.tsx` | Renders columns/rows, search filters, pagination, sort toggles, empty state, custom render, actions slot |
| `page-header.test.tsx` | Title/description/actions render, responsive layout, missing optional props |
| `empty-state.test.tsx` | Icon/title/description/action render, missing optional props |
| `status-badge.test.tsx` | All 4 states, custom label, pulsing dot presence |
| `code-block.test.tsx` | String input, object auto-stringify, copy button click, max height scroll |
| `sparkline.test.tsx` | SVG renders with correct dimensions, data normalization, empty data |
| `confirm-dialog.test.tsx` | Open/close, confirm callback, cancel callback, loading state, destructive variant |
| `time-ago.test.tsx` | Relative time display, tooltip with absolute date |

**Plugin component tests** (`src/components/plugin/__tests__/`):

| File | Tests |
|---|---|
| `slot.test.tsx` | Renders nothing with no injections, renders sorted by priority, passes context prop |
| `plugin-page.test.tsx` | Renders children, error boundary catches crash, shows plugin ID |

**Auth component tests** (`src/components/auth/__tests__/`):

| File | Tests |
|---|---|
| `protected-route.test.tsx` | Renders children when authenticated, redirects when not, skeleton during loading |

**Layout component tests** (`src/components/layout/__tests__/`):

| File | Tests |
|---|---|
| `app-sidebar.test.tsx` | Nav sections render, active link highlighting, collapse behavior, settings link |
| `header.test.tsx` | Breadcrumb from route, theme toggle, search trigger, plugin slot |
| `command-palette.test.tsx` | Opens on trigger, filters items, navigates on select, plugin items |
| `keyboard-shortcut-help.test.tsx` | Displays registered shortcuts, groups by scope, format key display |

### Playwright — E2E Browser Tests

Runs against the sandbox (real daemon + admin panel). `playwright.config.ts` configured with sandbox base URL.

**Test suites:**

| Suite | File | Coverage |
|---|---|---|
| Auth | `e2e/auth.spec.ts` | Login, invalid token error, token refresh, logout redirect |
| Dashboard | `e2e/dashboard.spec.ts` | Stat cards with real data, charts render, recent changes, system status, plugin slots |
| Routes | `e2e/routes.spec.ts` | List, search, create, edit, toggle enable, delete with confirmation, toast |
| Services | `e2e/services.spec.ts` | List, create with upstreams, edit, delete, LB policy selection |
| Policies | `e2e/policies.spec.ts` | List, create with JSON config, edit, delete, attached-to count |
| API Keys | `e2e/security.spec.ts` | Create key (shown once), copy, revoke with confirmation |
| Live Traffic | `e2e/traffic-live.spec.ts` | SSE connects, data appears, pause/resume, filters, detail sheet |
| Analytics | `e2e/traffic-analytics.spec.ts` | Time range tabs, charts render, stat cards |
| Navigation | `e2e/navigation.spec.ts` | All sidebar links, command palette, sidebar collapse, shortcuts help, breadcrumbs |
| Theme | `e2e/theme.spec.ts` | Dark/light toggle, persists across reload |
| Responsive | `e2e/responsive.spec.ts` | Desktop/tablet/mobile viewports, sidebar behavior, table layout |
| Accessibility | `e2e/a11y.spec.ts` | axe-core audit all pages, focus traps, keyboard nav, landmarks |
| Performance | `e2e/performance.spec.ts` | Page load times, table render, navigation transitions (baseline comparison) |

---

## Part 4: Performance Testing

### Go Benchmarks

Every performance-critical function gets `Benchmark*` functions.

**Key benchmark areas:**

| Area | Benchmarks |
|---|---|
| Config compilation | Routes → Caddy JSON translation, varying route counts (10, 100, 1000) |
| Store read/write | Operations/sec per dialect (SQLite, Postgres, MySQL), single and batch |
| CRDT merge | Merge operations, conflict resolution |
| Raft consensus | Log append, commit, snapshot |
| Cache | Hit/miss paths, eviction under pressure |
| Auth | Token validation throughput, token generation |
| Plugin/WASM | Execution overhead, cold start vs warm |
| gRPC | Serialization/deserialization, unary and streaming |
| REST gateway | Translation overhead, middleware chain |

### Benchmark Regression Detection

**Workflow:**
1. `make bench` runs all Go benchmarks, outputs to `bench/results.json`
2. `make bench-compare` uses `benchstat` to compare current vs `bench/baseline.json`
3. Prints table: function name, old ns/op, new ns/op, delta, significance
4. `make bench-baseline` saves current results as new baseline

**CI integration:**
- PR job runs benchmarks, compares against develop baseline
- Posts PR comment with regression/improvement table
- Advisory only — does NOT fail the build
- Baseline auto-updated when PR merges to develop

**Example output:**
```
name                    old time/op  new time/op  delta
ConfigCompile/10-8      12.3µs       14.1µs       +14.6% (p=0.002) REGRESSION
ConfigCompile/100-8     98.4µs       95.2µs       -3.2%  (p=0.041) improvement
StoreWrite/sqlite-8     45.0µs       38.0µs       -15.5% (p=0.001) improvement
TokenValidate-8         1.23µs       1.25µs       ~      (p=0.312)
```

### Load Testing (sandbox-based)

**`sandbox/loadtest/main.go`** — Go-based load generator:
- Configurable: target RPS, duration, concurrency, route distribution weights
- Measures: actual RPS achieved, latency percentiles (p50/p95/p99/p999), error rate, per-upstream distribution
- Outputs structured JSON for comparison
- Uses multiple goroutines with rate limiter for consistent request pacing

**Load profiles** (`sandbox/loadtest/profiles/`):

| Profile | Target RPS | Duration | Concurrency | Purpose |
|---|---|---|---|---|
| `standard.json` | 1,000 | 60s | 50 | Baseline throughput |
| `stress.json` | 10,000 | 120s | 200 | Peak capacity |
| `soak.json` | 1,000 | 600s | 50 | Memory leaks, connection exhaustion |
| `spike.json` | 100→10,000→100 | 60s | 200 | Burst handling, recovery |
| `config-change.json` | 1,000 | 60s | 50 | Apply config change at t=30s, measure disruption window |

**Regression detection:**
- `make sandbox-load` runs standard profile, saves results
- `make sandbox-load-compare` compares against `sandbox/loadtest/baseline.json`
- Key metrics compared: p50 latency, p99 latency, max RPS achieved, error rate
- Baseline updated on merge to develop

**Key scenarios to validate:**
- Sustained throughput: Rioku sustains 10K RPS across 5 upstreams
- Latency overhead: Rioku adds <1ms p50 to upstream latency
- Config change under load: disruption window < 100ms
- Connection scaling: 10→1000 concurrent, measure degradation curve
- Large config: 1000 routes + 200 services, config compilation + per-request routing latency

### Frontend Performance (Playwright)

Measured in `e2e/performance.spec.ts` using the Performance API:
- Page load time for each route (DOMContentLoaded + full load)
- Dashboard render with real data
- DataTable render with 100+ rows
- Navigation transition time (route change → new page painted)
- Baseline stored in `packages/web/e2e/perf-baseline.json`
- CI compares and flags regressions

---

## Part 5: File Organization

```
packages/daemon/
  internal/
    auth/auth_test.go
    build/build_test.go
    cache/distributed_test.go        (expand)
    caddy/compiler_test.go           (expand)
    cli/cli_test.go
    cluster/
      crdt/counter_test.go           (expand)
      discovery_test.go              (expand)
    config/engine_test.go            (expand)
    daemon/daemon_test.go
    gateway/
      api_test.go                    (integration, build tag)
      sse_test.go                    (integration, build tag)
    grpc/server_test.go
    keyring/keyring_test.go
    mcp/mcp_test.go
    pki/pki_test.go
    plugin/wasm/wasm_test.go         (expand)
    store/
      sqlite/sqlite_test.go          (expand)
      postgres/postgres_test.go      (integration, build tag)
      mysql/mysql_test.go            (integration, build tag)
      raft/raft_test.go              (expand)
    sync/sync_test.go
    tracestore/tracestore_test.go
    version/version_test.go
  bench/
    baseline.json

packages/web/
  vitest.config.ts
  playwright.config.ts
  src/
    lib/__tests__/
      api.test.ts
      auth.test.ts
      preferences.test.ts
      plugin-registry.test.ts
      plugin-loader.test.ts
      i18n.test.ts
      utils.test.ts
    hooks/__tests__/
      use-auth.test.ts
      use-theme.test.ts
      use-hotkeys.test.ts
      use-sse.test.ts
      use-mobile.test.ts
    components/rioku/__tests__/
      stat-card.test.tsx
      data-table.test.tsx
      page-header.test.tsx
      empty-state.test.tsx
      status-badge.test.tsx
      code-block.test.tsx
      sparkline.test.tsx
      confirm-dialog.test.tsx
      time-ago.test.tsx
    components/plugin/__tests__/
      slot.test.tsx
      plugin-page.test.tsx
    components/auth/__tests__/
      protected-route.test.tsx
    components/layout/__tests__/
      app-sidebar.test.tsx
      header.test.tsx
      command-palette.test.tsx
      keyboard-shortcut-help.test.tsx
  e2e/
    auth.spec.ts
    dashboard.spec.ts
    routes.spec.ts
    services.spec.ts
    policies.spec.ts
    security.spec.ts
    traffic-live.spec.ts
    traffic-analytics.spec.ts
    navigation.spec.ts
    theme.spec.ts
    responsive.spec.ts
    a11y.spec.ts
    performance.spec.ts
    perf-baseline.json

sandbox/
  apps/
    users/main.go
    products/main.go
    webhooks/main.go
    auth-service/main.go
    media/main.go
  config/
    seed.json
    api-keys.json
  loadtest/
    main.go
    profiles/
      standard.json
      stress.json
      soak.json
      spike.json
      config-change.json
    baseline.json
  scripts/
    start.sh
    stop.sh
  .data/                             (gitignored)
  README.md
```

## Part 6: Make Targets

```makefile
# Testing
make test                — Go unit tests with -race -coverprofile
make test-integration    — Go integration tests (-tags integration, needs DBs)
make test-web            — Vitest frontend unit/component tests with coverage
make test-e2e            — Start sandbox → Playwright → stop sandbox
make test-all            — All test targets in sequence
make test-coverage       — Generate combined HTML coverage report

# Benchmarks
make bench               — Run Go benchmarks, output to bench/results.json
make bench-compare       — Compare current results vs baseline (benchstat)
make bench-baseline      — Save current results as new baseline

# Sandbox
make sandbox             — Build + start full sandbox environment
make sandbox-stop        — Stop all sandbox processes
make sandbox-seed        — Re-seed config without full restart
make sandbox-load        — Run standard load profile
make sandbox-load-compare — Compare load results vs baseline

# Combined
make ci                  — Full CI pipeline: lint + test + test-web + bench
```

## Part 7: CI Updates

### New jobs in `.github/workflows/ci.yml`

**test-web:**
- Node 22 setup
- `npm ci` in packages/web
- `npx vitest run --coverage`
- Upload coverage artifact

**test-e2e:**
- Go + Node 22 setup
- Build sandbox apps + daemon
- Start sandbox (background)
- `npx playwright test`
- Upload failure screenshots as artifacts
- Stop sandbox in `always` step

**bench:**
- Go setup
- Run all Go benchmarks
- Compare against develop baseline using benchstat
- Post PR comment with regression/improvement table
- Advisory only — does not fail build
- On merge to develop: update baseline artifact

### New file: `docker-compose.ci.yml`

Used by `test-integration` job for Postgres + MySQL:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: rioku_test
      POSTGRES_USER: rioku
      POSTGRES_PASSWORD: test
    ports: ["5432:5432"]
  mysql:
    image: mariadb:11
    environment:
      MARIADB_DATABASE: rioku_test
      MARIADB_USER: rioku
      MARIADB_PASSWORD: test
      MARIADB_ROOT_PASSWORD: test
    ports: ["3306:3306"]
```

---

## Verification Checklist

- [ ] `make sandbox` starts all 5 apps + daemon, seeds config, prints URLs
- [ ] `make sandbox-stop` cleanly shuts down all processes
- [ ] All 5 upstream apps respond to requests through Rioku routes
- [ ] Admin panel shows real data from sandbox (routes, services, health)
- [ ] `make test` runs Go unit tests with race detector, reports coverage
- [ ] `make test-integration` runs against SQLite (locally), all 3 DBs in CI
- [ ] `make test-web` runs Vitest with coverage report
- [ ] `make test-e2e` starts sandbox, runs Playwright, stops sandbox
- [ ] `make bench` produces benchmark results
- [ ] `make bench-compare` compares against baseline, reports regressions
- [ ] `make sandbox-load` runs load test profile
- [ ] `make sandbox-load-compare` reports throughput/latency regressions
- [ ] CI runs all test jobs on PRs
- [ ] CI posts benchmark comparison comment on PRs
- [ ] CI uploads Playwright screenshots on e2e failure
- [ ] Coverage does not drop below baseline on any PR
