# TrafficService Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the TrafficService backend (trace capture, storage, gRPC service, SSE streaming) to unblock the admin panel dashboard (#36) and live traffic view (#38).

**Architecture:** Caddy's native log module writes structured JSON to a unixgram socket. The daemon's log ingester reads it into an in-memory ring buffer. A background aggregator computes per-minute bucket stats. The TrafficService gRPC implementation serves 7 RPCs against the ring buffer (live) and SQLite TraceStore (historical). An SSE endpoint at `/api/v1/events/traffic` streams live traces.

**Tech Stack:** Go 1.24+, SQLite (modernc.org/sqlite), protobuf/gRPC, Caddy JSON config, unixgram sockets.

**Design spec:** `docs/superpowers/specs/2026-04-09-traffic-service-design.md`

---

## File Structure

### New files to create

```
packages/daemon/internal/tracestore/
  driver.go              -- TraceStore interface, types, driver registration
  ringbuffer.go          -- Lock-free ring buffer for in-memory hot tier
  ringbuffer_test.go     -- Ring buffer unit tests
  aggregator.go          -- Background aggregator (ring buffer -> bucket tables)
  aggregator_test.go     -- Aggregator unit tests
  ingester.go            -- Unixgram socket log reader + JSON parser
  ingester_test.go       -- Ingester unit tests
  sqlite/
    sqlite.go            -- SQLite TraceStore driver implementation
    sqlite_test.go       -- SQLite driver tests
    migrations/
      000001_traces.up.sql    -- Schema: raw_traces, stats_buckets, route_buckets, etc.
      000001_traces.down.sql  -- Drop all trace tables

packages/daemon/internal/grpc/
  traffic_service.go     -- TrafficService gRPC implementation (7 RPCs)

packages/plugins/rioku-vars/
  module.go              -- Caddy handler module: sets route_id/service_id vars
  module_test.go         -- Module unit test

contrib-docs/
  operations/
    trace-storage.md     -- Operational guide: capacity planning, upgrades, backups
```

### Existing files to modify

```
packages/daemon/internal/tracestore/store.go     -- Replace stub with package doc
packages/daemon/internal/caddy/compiler.go        -- Inject rioku_vars + log config
packages/daemon/internal/caddy/compiler_test.go   -- Test log/vars injection
packages/daemon/internal/grpc/server.go           -- Register TrafficService
packages/daemon/internal/gateway/gateway.go       -- Register TrafficService REST handler
packages/daemon/internal/gateway/sse.go           -- Add traffic SSE endpoint
packages/daemon/internal/gateway/stub_routes.go   -- Remove traffic stubs
packages/daemon/internal/daemon/daemon.go         -- Wire tracestore + ingester lifecycle
packages/daemon/internal/config/file.go           -- Add buffer_size, errors_always, backup fields
```

---

## Task 1: TraceStore Interface and Types

**Files:**
- Replace: `packages/daemon/internal/tracestore/store.go`
- Create: `packages/daemon/internal/tracestore/driver.go`

This task defines the interfaces and types that every other component depends on. No tests needed — pure type definitions.

- [ ] **Step 1: Replace store.go with package documentation**

Replace `packages/daemon/internal/tracestore/store.go` with:

```go
// Package tracestore implements the request trace persistence layer.
// Traces live in a separate store from config (different access pattern:
// high-write, append-only, time-range queries).
//
// Architecture:
//   - Ring buffer (in-memory) for live SSE stream and real-time dashboard
//   - SQLite (default) or external DB for historical queries
//   - Pre-aggregated bucket tables for dashboard chart queries
//
// The ring buffer is always active. The persistent store is pluggable
// via the Driver interface with Register/New following the same pattern
// as the config store.
package tracestore
```

- [ ] **Step 2: Create driver.go with interfaces and types**

Create `packages/daemon/internal/tracestore/driver.go` with the full interface definitions, bucket types, driver registration, and config types. Key interfaces:

```go
type Driver interface {
    Open(ctx context.Context, cfg DriverConfig) error
    Close() error
    WriteBatch(ctx context.Context, traces []*riokuv1.RequestTrace) error
    WriteStatsBucket(ctx context.Context, b StatsBucket) error
    WriteRouteBucket(ctx context.Context, b RouteBucket) error
    WriteStatusBucket(ctx context.Context, b StatusBucket) error
    WriteModelBucket(ctx context.Context, b ModelBucket) error
    QueryTraces(ctx context.Context, q *riokuv1.TraceQuery) ([]*riokuv1.RequestTrace, int64, error)
    GetTrace(ctx context.Context, traceID string) (*riokuv1.RequestTrace, error)
    GetStatsBuckets(ctx context.Context, since, until time.Time) ([]StatsBucket, error)
    GetRouteBuckets(ctx context.Context, since, until time.Time) ([]RouteBucket, error)
    GetStatusBuckets(ctx context.Context, since, until time.Time) ([]StatusBucket, error)
    GetModelBuckets(ctx context.Context, since, until time.Time) ([]ModelBucket, error)
    GetSessionTraces(ctx context.Context, sessionID string) ([]*riokuv1.RequestTrace, error)
    ListSessions(ctx context.Context, activeOnly bool, since time.Time, limit, offset int) ([]SessionSummary, int64, error)
    Prune(ctx context.Context, rawRetention, aggRetention, aiRetention time.Duration) (int64, error)
}
```

Bucket types: `StatsBucket`, `RouteBucket`, `StatusBucket`, `ModelBucket`, `SessionSummary`.
Driver registration: `Register(name, factory)`, `New(name)` — same pattern as `internal/store`.
Config: `DriverConfig{Driver, Path, DSN, MaxSizeGB}`.

- [ ] **Step 3: Verify compilation**

Run: `cd packages/daemon && go vet ./internal/tracestore/`
Expected: Clean (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/daemon/internal/tracestore/
git commit -m "feat(tracestore): define TraceStore driver interface and types"
```

---

## Task 2: Ring Buffer

**Files:**
- Create: `packages/daemon/internal/tracestore/ringbuffer.go`
- Create: `packages/daemon/internal/tracestore/ringbuffer_test.go`

A bounded, thread-safe circular buffer with drop-oldest semantics and subscriber fan-out for SSE.

- [ ] **Step 1: Write ring buffer tests**

Create `ringbuffer_test.go` with tests for:
- `TestRingBuffer_PushAndSnapshot` — push N items, snapshot returns them in order
- `TestRingBuffer_Overflow` — push more than capacity, oldest dropped, count incremented
- `TestRingBuffer_Subscribe` — subscriber receives pushed items via channel
- `TestRingBuffer_SlowSubscriber` — slow subscriber gets dropped events, not blocking others
- `TestRingBuffer_Unsubscribe` — channel closed after unsubscribe
- `TestRingBuffer_DrainSince` — drain traces newer than a timestamp for batch flush

Tests use `*riokuv1.RequestTrace` as the element type. Each test creates a buffer with `NewRingBuffer(capacity)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/daemon && go test -v -count=1 ./internal/tracestore/ -run TestRingBuffer`
Expected: Compilation errors (RingBuffer not defined yet).

- [ ] **Step 3: Implement ring buffer**

Create `ringbuffer.go` with:
- `RingBuffer` struct: `sync.Mutex`, slice of `*riokuv1.RequestTrace`, head/tail/count, `dropped` counter, `subscribers` map of `chan *riokuv1.RequestTrace`
- `NewRingBuffer(capacity int) *RingBuffer`
- `Push(trace *riokuv1.RequestTrace)` — lock, append, drop oldest if full, fan out to subscribers (non-blocking send, skip if subscriber channel full)
- `Snapshot(limit int) []*riokuv1.RequestTrace` — lock, return copy of last N items
- `Subscribe(bufSize int) (<-chan *riokuv1.RequestTrace, func())` — returns channel and unsubscribe function
- `DrainSince(since time.Time) []*riokuv1.RequestTrace` — return and remove traces newer than timestamp (for batch flush to persistent store)
- `Dropped() int64` — return drop counter (atomic)
- `Len() int` — current count

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/daemon && go test -v -count=1 -race ./internal/tracestore/ -run TestRingBuffer`
Expected: All PASS with race detector clean.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/internal/tracestore/ringbuffer.go packages/daemon/internal/tracestore/ringbuffer_test.go
git commit -m "feat(tracestore): implement ring buffer with subscriber fan-out"
```

---

## Task 3: SQLite TraceStore Driver

**Files:**
- Create: `packages/daemon/internal/tracestore/sqlite/migrations/000001_traces.up.sql`
- Create: `packages/daemon/internal/tracestore/sqlite/migrations/000001_traces.down.sql`
- Create: `packages/daemon/internal/tracestore/sqlite/sqlite.go`
- Create: `packages/daemon/internal/tracestore/sqlite/sqlite_test.go`

- [ ] **Step 1: Write the migration SQL**

Create `000001_traces.up.sql`:
- `raw_traces` table: trace_id PK, all RequestTrace fields as columns, indexed on `(started_at)`, `(status_code, started_at)`, `(route_id, started_at)`, `(session_id)` 
- `stats_buckets` table: bucket_start PK, request_count, error_count, p50/p95/p99 latency, bytes_sent, bytes_recv
- `route_buckets` table: (bucket_start, route_id) PK, request_count, error_count, avg_latency_ms
- `status_buckets` table: (bucket_start, status_class) PK, request_count
- `model_buckets` table: (bucket_start, provider, model) PK, request_count, total_tokens, estimated_cost_usd
- `trace_schema_versions` table for migration tracking

Create `000001_traces.down.sql` — drop all tables.

SQLite-specific: use `TEXT` for timestamps (ISO 8601), `INTEGER` for counts, `REAL` for floats. WAL mode pragma in driver Open().

- [ ] **Step 2: Write SQLite driver tests**

Create `sqlite_test.go` with tests:
- `TestSQLite_OpenClose` — open temp DB, close cleanly
- `TestSQLite_WriteBatch` — write 100 traces, verify count
- `TestSQLite_QueryTraces` — write traces with different statuses/routes, query with filters, verify results
- `TestSQLite_GetTrace` — write one trace, get by ID
- `TestSQLite_WriteAndReadStatsBuckets` — write buckets, read back by time range
- `TestSQLite_WriteAndReadRouteBuckets` — same for route buckets
- `TestSQLite_Prune` — write traces with old timestamps, prune, verify deleted
- `TestSQLite_ListSessions` — write traces with session_ids, list sessions, verify aggregation

Tests use `t.TempDir()` for isolated SQLite files. Each test opens a fresh driver.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/daemon && go test -v -count=1 ./internal/tracestore/sqlite/ -run TestSQLite`
Expected: Compilation errors (driver not defined).

- [ ] **Step 4: Implement SQLite driver**

Create `sqlite.go`:
- `type driver struct` with `*sql.DB`, embed migration FS
- `init()` registers with `tracestore.Register("sqlite", func() tracestore.Driver { return &driver{} })`
- `Open()` — open SQLite with WAL mode, busy_timeout, run migrations
- `WriteBatch()` — `INSERT OR IGNORE INTO raw_traces` in a single transaction
- `QueryTraces()` — dynamic WHERE clause builder from TraceQuery fields, pagination via LIMIT/OFFSET
- `GetTrace()` — `SELECT ... WHERE trace_id = ?`
- `WriteStatsBucket()` / `GetStatsBuckets()` — INSERT and SELECT with time range
- Same for route/status/model buckets
- `Prune()` — `DELETE FROM raw_traces WHERE started_at < ?` for each retention tier. Return total rows deleted.
- `GetSessionTraces()` — `SELECT ... WHERE session_id = ? ORDER BY started_at`
- `ListSessions()` — `SELECT session_id, COUNT(*), MIN(started_at), MAX(started_at) FROM raw_traces WHERE session_id != '' GROUP BY session_id`
- Helper: `scanTrace(rows) *riokuv1.RequestTrace` — scan a row into a proto

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/daemon && go test -v -count=1 -race ./internal/tracestore/sqlite/ -run TestSQLite`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/internal/tracestore/sqlite/
git commit -m "feat(tracestore): SQLite driver with migrations and full query support"
```

---

## Task 4: Aggregator

**Files:**
- Create: `packages/daemon/internal/tracestore/aggregator.go`
- Create: `packages/daemon/internal/tracestore/aggregator_test.go`

Background goroutine that reads from the ring buffer every 60 seconds and writes pre-aggregated bucket rows to the TraceStore.

- [ ] **Step 1: Write aggregator tests**

Create `aggregator_test.go`:
- `TestAggregator_ComputeStatsBucket` — feed 100 traces with known latencies, verify P50/P95/P99 calculation, request/error counts
- `TestAggregator_ComputeRouteBuckets` — traces across 3 routes, verify per-route counts
- `TestAggregator_ComputeStatusBuckets` — traces with 2xx/4xx/5xx, verify status class counts
- `TestAggregator_RunCycle` — create aggregator with real ring buffer and SQLite store, push traces, run one aggregation cycle, read back buckets and verify

The `computeStatsBucket`, `computeRouteBuckets`, `computeStatusBuckets` functions are pure (take `[]*riokuv1.RequestTrace`, return bucket(s)) — easy to test without I/O.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/daemon && go test -v -count=1 ./internal/tracestore/ -run TestAggregator`
Expected: Compilation errors.

- [ ] **Step 3: Implement aggregator**

Create `aggregator.go`:
- `Aggregator` struct: ring buffer ref, TraceStore driver, interval, stop channel, done channel
- `NewAggregator(buf *RingBuffer, store Driver, interval time.Duration) *Aggregator`
- `Start(ctx context.Context)` — starts background goroutine
- `Stop()` — signals stop, waits for done
- `runCycle(ctx context.Context)` — snapshots ring buffer, computes buckets, writes to store
- Pure functions:
  - `computeStatsBucket(traces []*riokuv1.RequestTrace, bucketStart time.Time) StatsBucket` — calculates request_count, error_count (status >= 500), p50/p95/p99 via sorting, bytes totals
  - `computeRouteBuckets(traces, bucketStart) []RouteBucket` — group by route_id
  - `computeStatusBuckets(traces, bucketStart) []StatusBucket` — group by status class (2xx, 3xx, 4xx, 5xx)
  - `computeModelBuckets(traces, bucketStart) []ModelBucket` — group by provider+model from AITrace
  - `percentile(sorted []int64, p float64) int64` — percentile calculation on sorted slice

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/daemon && go test -v -count=1 -race ./internal/tracestore/ -run TestAggregator`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/internal/tracestore/aggregator.go packages/daemon/internal/tracestore/aggregator_test.go
git commit -m "feat(tracestore): background aggregator with pre-computed bucket tables"
```

---

## Task 5: Log Ingester

**Files:**
- Create: `packages/daemon/internal/tracestore/ingester.go`
- Create: `packages/daemon/internal/tracestore/ingester_test.go`

Reads structured JSON log lines from a unixgram socket, parses them into `*riokuv1.RequestTrace`, applies sampling, and pushes to the ring buffer.

- [ ] **Step 1: Write ingester tests**

Create `ingester_test.go`:
- `TestIngester_ParseLogLine` — parse a Caddy structured JSON log line into a RequestTrace. Cover all fields: method, path, host, status, latency, bytes, upstream address, rioku_route_id, rioku_service_id.
- `TestIngester_SamplingRate` — set rate=0.5, send 1000 traces, verify approximately 50% are pushed to ring buffer (with tolerance)
- `TestIngester_ErrorsAlwaysSampled` — set rate=0.1, send 100 traces where 10 are 5xx, verify all 10 errors are in buffer regardless of sampling
- `TestIngester_UnixgramSocket` — start ingester on a temp unixgram socket, write a log line, verify it appears in ring buffer

The `parseLogLine([]byte) (*riokuv1.RequestTrace, error)` function is pure — test it directly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/daemon && go test -v -count=1 ./internal/tracestore/ -run TestIngester`
Expected: Compilation errors.

- [ ] **Step 3: Implement ingester**

Create `ingester.go`:
- `Ingester` struct: socket path, ring buffer ref, sampling config, conn, stop/done channels, dropped counter
- `NewIngester(socketPath string, buf *RingBuffer, cfg SamplingConfig) *Ingester`
- `Start(ctx context.Context) error` — create unixgram socket, start read loop goroutine
- `Stop()` — close socket, wait for goroutine
- `readLoop()` — `conn.ReadFrom()` in a loop, parse each datagram, apply sampling, push to buffer
- `parseLogLine(data []byte) (*riokuv1.RequestTrace, error)` — parse Caddy JSON log format:
  ```json
  {
    "level": "info",
    "ts": 1234567890.123,
    "logger": "http.log.access.rioku",
    "msg": "handled request",
    "request": {"method": "GET", "host": "example.com", "uri": "/api/users", ...},
    "status": 200,
    "size": 1234,
    "duration": 0.005,
    "resp_headers": {...},
    "rioku_route_id": "uuid-here",
    "rioku_service_id": "uuid-here",
    "upstream": "10.0.0.1:8080"
  }
  ```
  Map to `RequestTrace` fields. Generate `trace_id` as UUID. Set `started_at` from `ts`.
- `shouldSample(trace *riokuv1.RequestTrace, cfg SamplingConfig) bool` — returns true if trace should be kept. Always true for errors (`errors_always && status >= 500`), slow requests (`duration >= slow_threshold`), AI requests (`ai_always && has AI headers`). Otherwise random with `rate`.
- `SamplingConfig` struct: `Rate float64`, `ErrorsAlways bool`, `AIAlways bool`, `SlowThresholdMS int`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/daemon && go test -v -count=1 -race ./internal/tracestore/ -run TestIngester`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/internal/tracestore/ingester.go packages/daemon/internal/tracestore/ingester_test.go
git commit -m "feat(tracestore): log ingester with unixgram socket and sampling"
```

---

## Task 6: TrafficService gRPC Implementation

**Files:**
- Create: `packages/daemon/internal/grpc/traffic_service.go`

Implements the 7 RPCs defined in `traffic.proto`. Uses the ring buffer for live data and TraceStore for historical queries.

- [ ] **Step 1: Implement TrafficService**

Create `traffic_service.go` following the ConfigService pattern:
- `type trafficService struct` embedding `riokuv1.UnimplementedTrafficServiceServer`
- Constructor: `newTrafficService(buf *tracestore.RingBuffer, store tracestore.Driver) *trafficService`
- Implement all 7 methods:

  **WatchTraffic** — subscribe to ring buffer, stream traces to client. Filter by request fields (route_ids, status_codes, ai_only, min_duration_ms). Unsubscribe on context cancellation.

  **QueryTraces** — delegate to `store.QueryTraces()`. Map proto `TraceQuery` to store query. Return `TraceQueryResult` with traces and pagination.

  **GetTrace** — delegate to `store.GetTrace()`. Return `codes.NotFound` if missing.

  **GetStats** — read `StatsBuckets` from store for the requested time range. Map to `TrafficStats` proto (list of `StatsBucket` messages).

  **GetTokenStats** — read `ModelBuckets` from store. Compute totals and model breakdown. Return `TokenStats` proto.

  **ListSessions** — delegate to `store.ListSessions()`. Map to `SessionList` proto.

  **GetSession** — get session traces from store. Build `SessionDetail` with summary and turn list.

- [ ] **Step 2: Verify compilation**

Run: `cd packages/daemon && go vet ./internal/grpc/`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add packages/daemon/internal/grpc/traffic_service.go
git commit -m "feat(grpc): implement TrafficService with 7 RPCs"
```

---

## Task 7: SSE Endpoint for WatchTraffic

**Files:**
- Modify: `packages/daemon/internal/gateway/sse.go`

Add `GET /api/v1/events/traffic` SSE endpoint following the existing `handleConfigSSE` pattern.

- [ ] **Step 1: Add traffic SSE handler**

In `sse.go`:
- Add `handleTrafficSSE(buf *tracestore.RingBuffer)` function. Pattern:
  1. Set SSE headers (Content-Type, Cache-Control, Connection, X-Accel-Buffering)
  2. Subscribe to ring buffer: `ch, unsub := buf.Subscribe(256)`
  3. `defer unsub()`
  4. Loop: read from `ch`, marshal to protojson, write `event: trace\ndata: %s\n\n`, flush
  5. On context done: return
- Update `RegisterSSERoutes` signature to accept `*tracestore.RingBuffer` parameter
- Register: `mux.HandleFunc("GET /api/v1/events/traffic", handleTrafficSSE(buf))`

- [ ] **Step 2: Verify compilation**

Run: `cd packages/daemon && go vet ./internal/gateway/`
Expected: Clean (may need to update callers — done in Task 10).

- [ ] **Step 3: Commit**

```bash
git add packages/daemon/internal/gateway/sse.go
git commit -m "feat(gateway): add SSE endpoint for live traffic streaming"
```

---

## Task 8: rioku_vars Caddy Module

**Files:**
- Create: `packages/plugins/rioku-vars/module.go`
- Create: `packages/plugins/rioku-vars/module_test.go`

Tiny Caddy handler module that sets `{http.vars.rioku_route_id}` and `{http.vars.rioku_service_id}` from JSON config. Injected by the compiler before `reverse_proxy`.

- [ ] **Step 1: Write module test**

Create `module_test.go`:
- `TestRiokuVars_SetsVariables` — create module with route_id and service_id config, serve a request through it with a recording next handler that reads the vars, verify they're set correctly.

Uses `caddyhttp.ExtraVarsCtxKey` to verify variables are set in the request context.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugins/rioku-vars && go test -v -count=1 ./...`
Expected: Compilation error.

- [ ] **Step 3: Implement module**

Create `module.go`:
```go
package riokuvars

import (
    "net/http"
    "github.com/caddyserver/caddy/v2"
    "github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

func init() {
    caddy.RegisterModule(Handler{})
}

type Handler struct {
    RouteID   string `json:"route_id,omitempty"`
    ServiceID string `json:"service_id,omitempty"`
}

func (Handler) CaddyModule() caddy.ModuleInfo {
    return caddy.ModuleInfo{
        ID:  "http.handlers.rioku_vars",
        New: func() caddy.Module { return new(Handler) },
    }
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
    caddyhttp.SetVar(r.Context(), "rioku_route_id", h.RouteID)
    caddyhttp.SetVar(r.Context(), "rioku_service_id", h.ServiceID)
    return next.ServeHTTP(w, r)
}

var _ caddyhttp.MiddlewareHandler = (*Handler)(nil)
```

This module needs its own `go.mod` since it's a Caddy plugin compiled via xcaddy.

- [ ] **Step 4: Initialize Go module**

```bash
cd packages/plugins/rioku-vars
go mod init github.com/riokulabs/rioku/plugins/rioku-vars
go get github.com/caddyserver/caddy/v2
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/plugins/rioku-vars && go test -v -count=1 ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/plugins/rioku-vars/
git commit -m "feat(caddy): rioku_vars handler module sets route/service context"
```

---

## Task 9: Compiler Changes

**Files:**
- Modify: `packages/daemon/internal/caddy/compiler.go`
- Modify: `packages/daemon/internal/caddy/compiler_test.go`

Inject `rioku_vars` handler before `reverse_proxy` in every route. Configure a named Caddy logger that writes structured JSON to the unixgram socket with custom fields.

- [ ] **Step 1: Write compiler tests for new behavior**

Add tests to `compiler_test.go`:
- `TestCompile_InjectsRiokuVars` — compile a route, verify the handler chain has `rioku_vars` before `reverse_proxy` in the output JSON
- `TestCompile_ConfiguresTraceLogger` — compile a full config, verify the top-level `logging` block includes a named logger `rioku.trace` with a `net` writer targeting the socket path, and custom fields for rioku_route_id and rioku_service_id

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/daemon && go test -v -count=1 ./internal/caddy/ -run TestCompile_Injects`
Expected: FAIL (new behavior not implemented).

- [ ] **Step 3: Modify compiler**

In `compiler.go`:

**In `CompileRoute()`** — prepend `rioku_vars` handler before `reverse_proxy`:
```go
varsHandler := map[string]any{
    "handler":    "rioku_vars",
    "route_id":   route.GetId(),
    "service_id": serviceID, // resolved from route target
}
caddyRoute["handle"] = []map[string]any{varsHandler, proxyHandler}
```

**In `Compile()`** — add a top-level `logging` configuration:
```go
config := map[string]any{
    "logging": map[string]any{
        "logs": map[string]any{
            "rioku_trace": map[string]any{
                "writer": map[string]any{
                    "output":  "net",
                    "address": "unix/" + c.traceSocketPath,
                },
                "encoder": map[string]any{
                    "format": "json",
                },
                "include": []string{"http.log.access.rioku"},
            },
        },
    },
    "apps": map[string]any{...},
}
```

**In traffic server block** — add access log logger name:
```go
server["logs"] = map[string]any{
    "default_logger_name": "rioku",
}
```

Add `traceSocketPath` field to `Compiler` struct. Pass it from `NewCompiler()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/daemon && go test -v -count=1 ./internal/caddy/`
Expected: All PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/internal/caddy/compiler.go packages/daemon/internal/caddy/compiler_test.go
git commit -m "feat(caddy): compiler injects rioku_vars handler and trace logger"
```

---

## Task 10: Wire Everything into Daemon Lifecycle

**Files:**
- Modify: `packages/daemon/internal/daemon/daemon.go`
- Modify: `packages/daemon/internal/grpc/server.go`
- Modify: `packages/daemon/internal/gateway/gateway.go`
- Modify: `packages/daemon/internal/gateway/stub_routes.go`
- Modify: `packages/daemon/internal/config/file.go`

Connect all the components in the daemon's `Start()` and `Stop()` methods.

- [ ] **Step 1: Add missing config fields**

In `config/file.go`, update `TracesConfig`:
- Add `BufferSize int` with `yaml:"buffer_size"` — default 10000
- Add `BackupConfig` struct with `Destination string`, `Interval time.Duration`, `RestoreOnStart bool`

Update `TracesSampling`:
- Add `ErrorsAlways bool` with `yaml:"errors_always"` — default true
- Add `SlowThresholdMS *int` with `yaml:"slow_threshold_ms"` — default 1000

Update `Default()` and `applyDefaults()` with new defaults.

- [ ] **Step 2: Update grpc/server.go**

- Add `trafficSvc` field to `Server` struct
- Add `tracestore.RingBuffer` and `tracestore.Driver` parameters to `NewServer`
- Create traffic service: `trafficSvc := newTrafficService(buf, traceDriver)`
- Register: `riokuv1.RegisterTrafficServiceServer(gs, trafficSvc)`
- Add accessor: `func (s *Server) TrafficService() riokuv1.TrafficServiceServer`
- Store `trafficSvc` in struct

- [ ] **Step 3: Update gateway/gateway.go**

- Add `tracestore.RingBuffer` parameter to `NewGateway`
- Register traffic service handler:
  ```go
  if err := riokuv1.RegisterTrafficServiceHandlerServer(ctx, gwMux, trafficSvc); err != nil {
      return nil, fmt.Errorf("register traffic service: %w", err)
  }
  ```
- Pass ring buffer to `RegisterSSERoutes`

- [ ] **Step 4: Update gateway/stub_routes.go**

Remove the two traffic stub routes (lines 19-20):
```go
// DELETE THESE:
mux.HandleFunc("GET /api/v1/traffic/analytics", handleStubEmptyObject())
mux.HandleFunc("GET /api/v1/traffic/ai", handleStubEmptyObject())
```

- [ ] **Step 5: Update daemon.go Start() and Stop()**

In `Start()`, after opening the main store and before starting Caddy:
```go
// Open trace store.
traceDriver, err := tracestore.New(d.cfg.Traces.Store)
if err != nil {
    return fmt.Errorf("create trace store driver: %w", err)
}
traceCfg := tracestore.DriverConfig{
    Driver:    d.cfg.Traces.Store,
    Path:      d.cfg.Traces.Path,
    MaxSizeGB: d.cfg.Traces.MaxSizeGB,
}
if err := traceDriver.Open(ctx, traceCfg); err != nil {
    return fmt.Errorf("open trace store: %w", err)
}
d.traceStore = traceDriver
d.ringBuffer = tracestore.NewRingBuffer(d.cfg.Traces.BufferSize)
log.Println("tracestore: ready")

// Start log ingester.
socketPath := filepath.Join(d.cfg.DataDir, "trace.sock")
samplingCfg := tracestore.SamplingConfig{...from d.cfg.Traces.Sampling...}
d.ingester = tracestore.NewIngester(socketPath, d.ringBuffer, samplingCfg)
if err := d.ingester.Start(ctx); err != nil {
    log.Printf("tracestore: ingester failed: %v", err)
}

// Start aggregator.
d.aggregator = tracestore.NewAggregator(d.ringBuffer, d.traceStore, 60*time.Second)
d.aggregator.Start(ctx)
```

Pass `d.ringBuffer` and `d.traceStore` to `NewServer()` and `NewGateway()`.

Pass `socketPath` to `NewCompiler()` so it can configure the Caddy log writer.

In `Stop()`, before closing the main store:
```go
if d.aggregator != nil { d.aggregator.Stop() }
if d.ingester != nil { d.ingester.Stop() }
if d.traceStore != nil { _ = d.traceStore.Close() }
```

Add new fields to `Daemon` struct: `traceStore`, `ringBuffer`, `ingester`, `aggregator`.

- [ ] **Step 6: Start pruning goroutine**

Add a background goroutine in `Start()` that runs `d.traceStore.Prune()` every hour with retention durations from config.

- [ ] **Step 7: Verify full compilation**

Run: `cd packages/daemon && go vet ./...`
Expected: Clean.

- [ ] **Step 8: Commit**

```bash
git add packages/daemon/internal/daemon/daemon.go packages/daemon/internal/grpc/server.go \
       packages/daemon/internal/gateway/gateway.go packages/daemon/internal/gateway/sse.go \
       packages/daemon/internal/gateway/stub_routes.go packages/daemon/internal/config/file.go
git commit -m "feat: wire TrafficService into daemon lifecycle"
```

---

## Task 11: Integration Test

**Files:**
- Modify: `packages/daemon/internal/daemon/integration_test.go`

Add a test that validates the full trace pipeline: daemon start -> create route -> send traffic -> verify traces appear in ring buffer and TraceStore.

- [ ] **Step 1: Write integration test**

Add `TestTrafficTracing` to `integration_test.go`:
1. Start daemon (same pattern as `TestFullProxyFlow`)
2. Create service + route via REST API
3. Wait for Caddy sync
4. Send 10 HTTP requests through Caddy traffic port
5. Wait briefly for ingester + aggregator cycle
6. Query `GET /api/v1/traffic/traces` — verify traces exist
7. Query `GET /api/v1/traffic/stats` — verify stats buckets have non-zero counts
8. Verify response includes the correct route_id and service_id

- [ ] **Step 2: Run integration test**

Run: `cd packages/daemon && go test -tags integration -run TestTrafficTracing -v -count=1 -timeout 60s ./internal/daemon/`
Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku && make test-race`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/daemon/internal/daemon/integration_test.go
git commit -m "test: integration test for full trace pipeline"
```

---

## Task 12: Update Contributor Documentation

**Files:**
- Create: `contrib-docs/operations/trace-storage.md`
- Modify: `contrib-docs/design/architecture.md`

- [ ] **Step 1: Create operational guide**

Create `contrib-docs/operations/trace-storage.md` covering:

- **Overview** — what the trace system does, components (ingester, ring buffer, aggregator, TraceStore)
- **Capacity planning** — tables from the design spec (RPS vs retention vs storage, SQLite comfort zones)
- **Configuration reference** — full `traces:` YAML block with every option explained
- **When to upgrade from SQLite** — concrete thresholds, warning signs, CLI diagnostics (`rku traces status`)
- **Backend setup guides:**
  - SQLite (default, nothing to do)
  - ClickHouse (single-node Docker, schema auto-created, connection string)
  - Postgres/TimescaleDB (extension setup, connection string)
  - MinIO backup (Docker setup, bucket creation, config)
- **Cluster considerations** — node-local traces, query fan-out, NTP requirements
- **Ephemeral infrastructure** — K8s/serverless warnings, required backup config
- **Troubleshooting** — common issues (disk full, high drop rate, slow queries)

- [ ] **Step 2: Update architecture.md**

Add a section for the TrafficService in the architecture doc:
- Trace capture pipeline (Caddy log -> unixgram -> ingester -> ring buffer -> aggregator -> SQLite)
- TraceStore driver interface
- Pre-aggregation strategy
- SSE streaming architecture
- Failure modes summary (reference design spec section 7)

- [ ] **Step 3: Commit**

```bash
git add contrib-docs/operations/trace-storage.md contrib-docs/design/architecture.md
git commit -m "docs: trace storage operational guide and architecture updates"
```

---

## Task 13: Final Cleanup and Validation

- [ ] **Step 1: Run full test suite with race detector**

Run: `cd /home/dmehaffy/Documents/RiokuLabs/rioku && make test-race`
Expected: All PASS.

- [ ] **Step 2: Run integration tests**

Run: `cd packages/daemon && go test -tags integration -v -count=1 -timeout 120s ./internal/daemon/`
Expected: All PASS (TestFullProxyFlow, TestDegradedMode, TestTrafficTracing).

- [ ] **Step 3: Build daemon binary**

Run: `make build-daemon`
Expected: Binary produced at `bin/rioku`.

- [ ] **Step 4: Verify sandbox works**

Run: `SANDBOX_ROOT_PASSWORD=TestRoot1234! make sandbox`
Verify:
- Dashboard at `localhost:7778` loads with real traffic data after sending requests
- Live traffic page shows request stream
- No errors in daemon log

- [ ] **Step 5: Close related issues**

Comment on #36 and #38 with implementation details. Update #34 progress.

- [ ] **Step 6: Final commit**

Any remaining cleanup or fixes from validation.
