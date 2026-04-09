# TrafficService & TraceStore Design

**Date:** 2026-04-09
**Status:** Approved
**Unblocks:** #36 (dashboard live data), #38 (live traffic view), #34 (admin panel wiring)

## 1. Problem Statement

The admin panel's dashboard charts (RPS, latency percentiles, error rate) and live traffic view are blocked on a backend implementation. The frontend is built and waiting. The proto definitions are complete (7 RPCs). The gRPC/REST gateway infrastructure exists. What's missing is:

1. A way to capture request trace data from Caddy with zero latency impact
2. A storage layer optimized for high-write, append-only, time-range query workloads
3. A gRPC service implementing the TrafficService RPCs
4. An SSE endpoint for real-time traffic streaming

## 2. Architecture Overview

```
Caddy (child process)                    Daemon (parent process)
+---------------------+                 +------------------------------+
|                     |   unixgram      |                              |
|  rioku_vars handler |   socket        |  Log Ingester goroutine      |
|        |            |  ----------->   |    |                         |
|  reverse_proxy      |  structured     |  Ring Buffer (in-memory)     |
|        |            |  JSON, fire     |    |          |              |
|  native log module  |  and forget     |  Aggregator  |  SSE fanout  |
|  (Zap, zero-alloc)  |                 |    |          |              |
|                     |                 |  TraceStore (SQLite/ext)     |
+---------------------+                 |    |                         |
                                        |  TrafficService (gRPC)      |
                                        |    |              |          |
                                        |  REST gateway   SSE endpoint|
                                        |    |              |          |
                                        |  Admin Panel (React)        |
                                        +------------------------------+
```

### Components

1. **`rioku_vars`** — Custom Caddy handler module (~50 LOC). Injected before `reverse_proxy` by the compiler. Sets Caddy placeholders (`{http.vars.rioku_route_id}`, `{http.vars.rioku_service_id}`) that the native log module references. This is the only custom Caddy module built for Phase 1.

2. **Native Caddy `log` module** — Configured by the compiler with a `net` writer pointing to a unixgram socket. Captures all standard HTTP metadata plus the `rioku_vars` placeholders. Runs post-response, zero-allocation (Zap). Zero client-visible latency.

3. **Log Ingester** — Daemon goroutine listening on the unixgram socket. Parses JSON log lines into `RequestTrace` protos. Applies sampling per config. Pushes into the ring buffer.

4. **Ring Buffer** — Bounded in-memory circular buffer. Powers the live SSE stream and real-time dashboard gauges. Feeds the background aggregator and batch flusher. Drop-oldest semantics when full.

5. **Aggregator** — Background goroutine running every 60 seconds. Reads from the ring buffer and computes pre-aggregated stats into bucket tables (stats, routes, status codes, AI models). Dashboard charts read these buckets, never raw traces.

6. **TraceStore** — Pluggable storage backend. Default: SQLite (pure Go, zero deps). Optional: ClickHouse, Postgres, TimescaleDB. Stores raw traces and pre-aggregated bucket tables.

7. **TrafficService** — gRPC service implementing all 7 RPCs against the ring buffer (live) and TraceStore (historical). Registered in gRPC server and REST gateway alongside ConfigService and HealthService.

8. **SSE endpoint** — `GET /api/v1/events/traffic` translates gRPC `WatchTraffic` server-streaming RPC to SSE, following the existing `handleConfigSSE` pattern.

## 3. Design Decisions

### 3.1 Native Caddy logging over custom trace plugin

**Decision:** Use Caddy's built-in `log` module with a `net` writer for trace capture. Build only a minimal `rioku_vars` handler to inject Rioku context.

**Rationale:**
- Caddy runs as a child process (`exec.Command`), not a linked library. A custom plugin would still need IPC (serialization + socket) to reach the daemon — same as native logging.
- Caddy's log module is zero-allocation (Zap), battle-tested, and maintained by the Caddy team. A custom implementation would reimplement this.
- Tracing (read-only, post-response) and transformation (body modification, pre-proxy) are different responsibilities with different timing, performance profiles, and failure modes. Combining them creates a god module.
- Native logging handles the high-volume, every-request observability path. Custom modules are reserved for things native Caddy can't do (PII redaction, AI token counting, guardrails — Phase 5).

**Trade-off:** We lose the ability to capture response body content (needed for AI token counting). This is acceptable because the LLM proxy is Phase 5+. AI trace fields remain empty until then.

**Competitive reference:** This mirrors Kong's architecture where the `log_by_lua` phase handles observability (post-response, zero latency) while `access_by_lua` and `body_filter_by_lua` handle transformation (pre/post-proxy, body access).

### 3.2 Unixgram socket over stream socket

**Decision:** Use `unixgram` (datagram) Unix socket instead of `unix` (stream).

**Rationale:** If the daemon's reader falls behind, a stream socket blocks the sender (Caddy's log writer). Even though logging runs post-response, blocked goroutines leak and eventually OOM Caddy. Datagram sockets have fire-and-forget semantics — datagrams are dropped when the kernel buffer is full, never blocking the sender. Traces are best-effort telemetry; dropping some under extreme load is the correct behavior.

**Mitigation:** Set a large kernel receive buffer (`SO_RCVBUF`) to absorb bursts. Monitor `traces_dropped_total` metric.

### 3.3 Separate storage from config store

**Decision:** Traces live in a dedicated TraceStore, not the raft config store.

**Rationale:** The config store uses raft consensus — every write is replicated to a majority of nodes. At 1000 RPS, that's 1000 raft log entries per second through consensus. Raft is designed for tens of writes per second. Traces would saturate the cluster with replication traffic instead of serving requests.

Traces have a fundamentally different access pattern: high-write, append-only, time-range queries, bounded retention. The config store is low-write, high-read, strongly consistent, unbounded retention.

### 3.4 SQLite as default with pluggable backends

**Decision:** Default to SQLite (pure Go via `modernc.org/sqlite`). Support ClickHouse, Postgres, and TimescaleDB as optional external backends.

**Rationale:**
- Pure Go preserves the single-binary, zero-dependency distribution. No CGo, no cross-compilation issues, no Sharp-style platform headaches.
- SQLite is production-viable for the trace workload when combined with pre-aggregation (see 3.5) and sampling. Proven by Cloudflare D1, Fly.io LiteFS, Rails 8.
- DuckDB would be 10-100x faster for analytical queries but requires CGo. Rejected for the core binary. Could be revisited as an optional build tag in the future.

### 3.5 Pre-aggregated bucket tables

**Decision:** Compute and store per-minute aggregate buckets for all dashboard query patterns. Dashboard charts never query raw traces.

**Rationale:** The admin panel's `GROUP BY` queries (top routes, status breakdown, model breakdown) require full table scans on raw traces. At 26M+ rows (100 RPS, 30-day retention), these take 1-5 seconds on SQLite. Pre-aggregating into minute-buckets reduces dashboard queries from millions of rows to thousands, achieving sub-millisecond response times regardless of traffic volume or retention period.

**Bucket tables:**

| Table | Dimensions | Row size | 90-day rows | 90-day size |
|-------|-----------|----------|-------------|-------------|
| `stats_buckets` | time | ~200 bytes | 129,600 | ~26 MB |
| `route_buckets` | time × route_id | ~150 bytes | 129,600 × N | ~100 MB |
| `status_buckets` | time × status_class | ~100 bytes | 648,000 | ~13 MB |
| `model_buckets` | time × provider × model | ~200 bytes | 129,600 × N | ~50 MB |

Total pre-aggregated storage: under 200 MB at 90-day retention. Trivial for SQLite.

### 3.6 Three-tier retention

**Decision:** Independent retention periods for raw traces, pre-aggregated stats, and AI sessions.

**Rationale:** Raw traces are storage-expensive and only needed for individual trace lookup and filtered search. Pre-aggregated stats are tiny and power all dashboard charts. AI sessions have higher per-trace storage (token data) but higher business value.

```yaml
traces:
  retention:
    raw_traces: 7d        # individual request traces
    aggregated_stats: 90d  # minute-buckets for dashboard charts
    ai_sessions: 30d       # AI conversation traces
```

### 3.7 Tiered durability

**Decision:** Three tiers of durability matching deployment complexity.

| Tier | Mechanism | Survives | Config |
|------|-----------|----------|--------|
| 1 (default) | Local SQLite | Process restart | `traces.store: sqlite` |
| 2 (recommended for production) | SQLite + object storage backup | Node death, cluster failure | `traces.backup.destination: s3://...` |
| 3 (scale) | External database | External DB's durability guarantees | `traces.store: clickhouse` |

Tier 2 uses continuous WAL streaming to S3-compatible object storage (Litestream pattern). On node startup, restores from backup if local database is missing. Pure Go, ~10 second lag.

### 3.8 Extensibility for AI/LLM pipeline (Phase 5)

**Decision:** Observability (native Caddy log) and transformation (custom Caddy handlers) are separate pipelines. The compiler orchestrates which handlers are injected per-route based on attached policies.

```
Route handler chain (ordered by compiler):
  1. rioku_vars        -> sets route_id, service_id (always, ~0 cost)
  2. rioku_pii         -> PII redaction (Phase 5, AI routes only)
  3. rioku_guardrail   -> content filtering (Phase 5, AI routes only)
  4. reverse_proxy     -> forwards to upstream
     +- handle_response -> token counting (Phase 5, AI routes only)
  5. (implicit) log    -> trace capture (always, post-response, zero cost)
```

Custom Caddy modules are only built where native Caddy can't do the job: body inspection and modification. Each is small, focused, independently testable, and only injected on routes with matching policies. Since xcaddy is already in the build pipeline for third-party plugins, the build cost is already paid.

## 4. TraceStore Interface

```go
// TraceStore is the pluggable storage backend for request traces.
type TraceStore interface {
    TraceWriter
    TraceReader
    io.Closer
}

// TraceWriter handles trace ingestion.
type TraceWriter interface {
    WriteBatch(ctx context.Context, traces []*riokuv1.RequestTrace) error
    WriteStatsBucket(ctx context.Context, bucket *StatsBucket) error
    WriteRouteBucket(ctx context.Context, bucket *RouteBucket) error
    WriteStatusBucket(ctx context.Context, bucket *StatusBucket) error
    WriteModelBucket(ctx context.Context, bucket *ModelBucket) error
    Prune(ctx context.Context) (int64, error)
}

// TraceReader handles trace queries.
type TraceReader interface {
    QueryTraces(ctx context.Context, q *riokuv1.TraceQuery) (*riokuv1.TraceQueryResult, error)
    GetTrace(ctx context.Context, traceID string) (*riokuv1.RequestTrace, error)
    GetStats(ctx context.Context, q *riokuv1.StatsQuery) (*riokuv1.TrafficStats, error)
    GetTokenStats(ctx context.Context, q *riokuv1.TokenQuery) (*riokuv1.TokenStats, error)
    ListSessions(ctx context.Context, q *riokuv1.SessionQuery) (*riokuv1.SessionList, error)
    GetSession(ctx context.Context, sessionID string) (*riokuv1.SessionDetail, error)
}

// BackupCapable is optionally implemented by stores that support
// continuous backup to object storage.
type BackupCapable interface {
    StartBackup(ctx context.Context, cfg BackupConfig) error
    Restore(ctx context.Context, cfg BackupConfig) error
}
```

Driver registration follows the config store pattern: `Register("sqlite", factory)`, `Register("clickhouse", factory)`.

## 5. TrafficService RPCs

All 7 RPCs defined in `traffic.proto`:

| RPC | Data source | Latency target |
|-----|-------------|----------------|
| `WatchTraffic` (stream) | Ring buffer → SSE | Real-time (~100ms) |
| `GetStats` | `stats_buckets` table | < 10ms |
| `GetTokenStats` | `model_buckets` table | < 10ms |
| `QueryTraces` | `raw_traces` table (indexed, paginated) | < 200ms |
| `GetTrace` | `raw_traces` table (PK lookup) | < 5ms |
| `ListSessions` | `raw_traces` table (indexed by session_id) | < 50ms |
| `GetSession` | `raw_traces` table (indexed by session_id) | < 50ms |

## 6. Compiler Changes

The compiler (`caddy/compiler.go`) gains two responsibilities:

1. **Inject `rioku_vars` handler** before `reverse_proxy` in every route. Sets `{http.vars.rioku_route_id}` and `{http.vars.rioku_service_id}` from the compiled route/service metadata.

2. **Configure logging** in the compiled Caddy config. Add a named logger with a `net` writer targeting the unixgram socket, custom fields referencing the `rioku_vars` placeholders, and JSON encoding.

## 7. Failure Modes and Mitigations

### 7.1 Disk full — traces must never kill the node

Traces are expendable; config is not. The trace store enforces `traces.max_size_gb` (default: 50 GB). When approaching the limit: stop writing raw traces, keep only pre-aggregated buckets, emit warning. Recommend `traces.path` be on a separate filesystem from `data_dir`.

### 7.2 Ring buffer overflow — drop, never block

If ingestion rate exceeds flush rate, drop oldest traces from the ring buffer. Increment `traces_dropped_total` metric. Live SSE stream shows a gap. Traffic keeps flowing at full speed. Observability degrades gracefully — never impacts the system it's observing.

### 7.3 Unix socket backpressure — fire and forget

Unixgram sockets drop datagrams when the kernel buffer is full rather than blocking the sender. Caddy's log writer never blocks. Set large `SO_RCVBUF` to absorb bursts.

### 7.4 Trace storm — adaptive sampling

Under sustained load (ring buffer > 80% capacity), dynamically reduce sampling rate. Log the change. Errors, slow requests, and AI requests bypass sampling per config (`errors_always`, `slow_threshold_ms`, `ai_always`).

### 7.5 Retention pruning — partition, don't vacuum

Partition raw traces by day using separate SQLite files (e.g., `traces-2026-04-09.db`). Drop old partitions by deleting the file. Instant, no locking, no VACUUM. The TraceStore opens today's file for writes and recent files for reads. Queries spanning multiple days open the relevant partition files.

### 7.6 Slow SSE subscribers — per-subscriber backpressure

Each SSE subscriber gets a bounded channel. If full, events are dropped for that subscriber with an `event: gap` notification. Slow consumers never affect other subscribers or the ring buffer.

### 7.7 Cluster query fan-out — deadline with partial results

Query fan-out to peer nodes uses a 2-second deadline. Responses that arrive are merged. Missing nodes are reported in response metadata (`"partial": true, "missing_nodes": [...]`). Dashboard shows a warning banner.

### 7.8 Corrupted backup restore — verify before use

Checksum every backup. On restore: verify checksum, run `PRAGMA integrity_check`, only then use. If verification fails, start with an empty trace store and log a warning.

### 7.9 Daemon crash mid-flush — idempotent writes

Traces have unique IDs (`trace_id`). Batch inserts use `INSERT OR IGNORE`. Duplicates are harmless. Gaps are acceptable.

### 7.10 Pre-aggregation falls behind — merge, never skip

Aggregator reads from the in-memory ring buffer (microseconds). If a cycle is slow, merge missed intervals into the next bucket. Hard timeout: 10 seconds per cycle. Dashboard shows slightly coarser granularity, never gaps.

## 8. Storage Capacity Planning

### 8.1 Raw trace size estimate

A `RequestTrace` (trace_id, method, path, host, status, latency, route_id, service_id, upstream, actor, timestamps) stores at approximately **600 bytes per trace** in SQLite including indexes.

### 8.2 Capacity at 10% sampling

| RPS | Per day | 7 days | 14 days | 30 days | 60 days | 90 days |
|-----|---------|--------|---------|---------|---------|---------|
| 10 | 52 MB | 360 MB | 730 MB | 1.6 GB | 3.1 GB | 4.7 GB |
| 100 | 520 MB | 3.6 GB | 7.3 GB | 16 GB | 31 GB | 47 GB |
| 500 | 2.6 GB | 18 GB | 36 GB | 78 GB | 156 GB | 234 GB |
| 1,000 | 5.2 GB | 36 GB | 73 GB | 156 GB | 311 GB | 467 GB |

### 8.3 SQLite comfort zone

SQLite performs well with proper indexing up to approximately **50 GB** of raw trace data. Beyond this, index cache-busting causes noticeable query degradation. Combined with the pre-aggregation strategy, SQLite is viable for:

| Retention | Max RPS (SQLite, 10% sampling) |
|-----------|-------------------------------|
| 7 days | ~500 RPS |
| 14 days | ~200 RPS |
| 30 days | ~100 RPS |
| 60 days | ~50 RPS |
| 90 days | ~25 RPS |

### 8.4 Pre-aggregated bucket storage

Under 200 MB at 90-day retention regardless of traffic volume. Always viable on SQLite.

### 8.5 ClickHouse compression advantage

ClickHouse achieves 15-50x compression on trace data. At 15x conservative estimate:

| RPS (10% sampled) | 30 days | 90 days |
|-----|---------|---------|
| 100 | 1 GB | 3.1 GB |
| 500 | 5.2 GB | 16 GB |
| 1,000 | 10 GB | 31 GB |

## 9. Recommended Storage Backends

All recommended backends are self-hostable and can be tested locally in CI. Cloud-native equivalents are noted but not officially supported or tested.

### 9.1 SQLite (default, embedded)

- **Use when:** Single node, edge, dev, staging, or production under the limits in 8.3.
- **Strengths:** Zero dependencies, single binary, pure Go, zero config. Production-proven (Cloudflare D1, Fly.io LiteFS, Rails 8, every phone on Earth). Most tested software in existence (4.5+ billion test cases, 100% branch coverage, aviation/automotive certified).
- **Weaknesses:** Single writer, no columnar storage, VACUUM overhead on large files. Mitigated by batched writes, pre-aggregation, and day-partitioned pruning.
- **Durability:** Local file. Survives process restarts. Add `traces.backup` for node-death resilience.
- **Cloud equivalent:** Turso, Cloudflare D1 (not tested by us).

### 9.2 ClickHouse (recommended for scale, self-hosted)

- **Use when:** Production at >100 RPS with >7 day retention, or when long-term trace analytics matter.
- **Strengths:** Purpose-built for this exact workload. Columnar storage, vectorized execution, 15-50x compression. Handles billions of traces with sub-second aggregation. Used by Jaeger, SigNoz, Grafana, and Cloudflare for trace storage. Single binary install, runs on 2GB RAM for small deployments.
- **Weaknesses:** External process to operate. Not embedded.
- **Self-hosted:** `docker run clickhouse/clickhouse-server` or single binary download. No cluster needed for moderate scale — single-node ClickHouse handles thousands of RPS.
- **CI testable:** Yes. Docker container in CI, ~5 second startup.
- **Cloud equivalent:** ClickHouse Cloud, AWS (not tested by us).

### 9.3 PostgreSQL + TimescaleDB (alternative, self-hosted)

- **Use when:** User already operates Postgres and wants unified infrastructure. TimescaleDB extension adds time-series optimizations (hypertables, continuous aggregates, compression).
- **Strengths:** Familiar to most teams. Strong ecosystem. TimescaleDB adds automatic partitioning, built-in retention policies, and 10-20x compression. Can share the same Postgres instance as the config store (different database/schema).
- **Weaknesses:** Less compression and query speed than ClickHouse for analytical workloads. Requires TimescaleDB extension for competitive performance.
- **Self-hosted:** Standard Postgres + `CREATE EXTENSION timescaledb`. Available in most Postgres Docker images.
- **CI testable:** Yes. `docker run timescale/timescaledb` or plain Postgres.
- **Cloud equivalent:** Timescale Cloud, Amazon RDS, Supabase (not tested by us).

### 9.4 Plain PostgreSQL (minimal alternative, self-hosted)

- **Use when:** User has Postgres but not TimescaleDB, and trace volume is moderate.
- **Strengths:** Zero extensions needed. Can share infrastructure with config store.
- **Weaknesses:** No automatic partitioning, no native compression, slower aggregation than TimescaleDB or ClickHouse.
- **CI testable:** Yes. Standard Postgres container.
- **Scaling guidance:** Viable up to ~50M raw traces. Beyond that, recommend TimescaleDB extension or ClickHouse.

### 9.5 Object storage backup (durability layer, self-hosted)

- **Use when:** Running SQLite but need durability beyond node-local disk.
- **Mechanism:** Continuous WAL streaming to S3-compatible object storage (Litestream pattern). Pure Go. ~10 second lag.
- **Self-hosted:** MinIO (`docker run minio/minio`). S3-compatible API, runs anywhere.
- **CI testable:** Yes. MinIO container, ~2 second startup.
- **Cloud equivalent:** AWS S3, GCS, Azure Blob Storage (S3-compatible API).

### 9.6 Not recommended

| Backend | Why |
|---------|-----|
| DuckDB | Excellent analytical performance but requires CGo. Cross-compilation and static linking issues conflict with Rioku's pure-Go, single-binary distribution model. |
| MongoDB | Not optimized for time-series analytical queries. No compression advantage. |
| Redis/Valkey | In-memory only. Not suitable for trace retention beyond minutes. |
| Elasticsearch | Heavy, expensive, overkill for structured trace data with known query patterns. |

## 10. Configuration Reference

```yaml
traces:
  # Storage backend: sqlite (default) | clickhouse | postgres
  store: sqlite

  # Path for embedded stores (sqlite)
  path: /var/lib/rioku/traces

  # Connection string for external stores
  dsn: ""

  # Ring buffer capacity (in-memory, powers live view)
  buffer_size: 10000

  # Maximum disk usage for embedded stores
  max_size_gb: 50

  retention:
    raw_traces: 7d          # individual request traces
    aggregated_stats: 90d    # pre-computed dashboard buckets
    ai_sessions: 30d         # AI conversation traces

  sampling:
    rate: 1.0               # 0.0-1.0 (1.0 = 100%, 0.1 = 10%)
    ai_always: true          # always trace AI requests
    errors_always: true      # always trace 5xx responses
    slow_threshold_ms: 1000  # always trace requests slower than this

  content:
    store_messages: false    # store LLM request/response content
    redact_patterns:         # PII redaction patterns
      - '\b\d{4}[-]?\d{4}[-]?\d{4}[-]?\d{4}\b'  # credit cards
      - '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b'  # emails

  backup:
    destination: ""          # s3://bucket/prefix/ or empty to disable
    interval: 10s            # backup frequency
    restore_on_start: true   # restore from backup if local DB missing
```

## 11. Operational Guidance

### 11.1 When to upgrade from SQLite

The daemon exposes trace storage status:

```
$ rku traces status
Store:            sqlite
Raw traces:       12.4 GB (7 day retention, 847,293 traces)
Stats buckets:    4.2 MB (90 day retention, 129,600 buckets)
AI sessions:      1.1 GB (30 day retention, 3,412 sessions)
Sampling:         10% (errors: always, slow >1s: always, AI: always)
Disk budget:      50 GB max (24.8% used)
```

Warnings are emitted when:
- Trace store exceeds 80% of `max_size_gb`
- Query latency for trace search exceeds 2 seconds
- Adaptive sampling has been active for >5 minutes

Recommended actions are provided:
```
WARN: trace store at 80% of disk budget (40.1 GB / 50 GB)
  -> reduce retention: rku config set traces.retention.raw_traces 3d
  -> reduce sampling:  rku config set traces.sampling.rate 0.05
  -> upgrade backend:  set traces.store=clickhouse in rioku.yaml
```

### 11.2 Cluster deployments

- Raw traces are node-local. Each node stores traces for the traffic it handled.
- Pre-aggregated stats can be merged across nodes via gRPC query fan-out.
- NTP synchronization is required for consistent cross-node time-range queries.
- For unified cluster-wide trace visibility, use an external backend (ClickHouse/Postgres) that all nodes write to.

### 11.3 Ephemeral infrastructure (Kubernetes, serverless)

Nodes on ephemeral infrastructure must not use Tier 1 (local SQLite with no backup). Recommended configurations:
- **Tier 2:** SQLite + S3/MinIO backup (`traces.backup.destination`)
- **Tier 3:** External ClickHouse or Postgres (`traces.store: clickhouse`)

The `rku init` wizard should detect ephemeral environments and warn.

### 11.4 Edge deployments

SQLite is the ideal edge backend. Single binary, no network dependency, bounded disk usage. Traces are locally useful for debugging even without external connectivity. If network is available, object storage backup provides durability.

## 12. Testing Strategy

All storage backends are testable in CI with self-hosted services:

| Backend | CI setup | Startup time |
|---------|----------|-------------|
| SQLite | None (embedded) | Instant |
| ClickHouse | `docker run clickhouse/clickhouse-server` | ~5s |
| Postgres | `docker run postgres:16` | ~3s |
| TimescaleDB | `docker run timescale/timescaledb` | ~3s |
| MinIO (backup) | `docker run minio/minio` | ~2s |

Integration tests run against all backends. Performance benchmarks run against SQLite and ClickHouse to validate:
- Batch insert throughput (target: >10K traces/sec on SQLite, >100K on ClickHouse)
- Pre-aggregated bucket query latency (target: <10ms on all backends)
- Filtered trace search latency (target: <200ms for time-bounded indexed queries)
- Ring buffer throughput (target: >100K traces/sec, in-memory)

Cloud-native equivalents (AWS S3, ClickHouse Cloud, RDS) are documented as compatible but not tested in CI due to cost.
