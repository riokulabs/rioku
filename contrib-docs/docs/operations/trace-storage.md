# Trace Storage Operations Guide

## Overview

Rioku captures HTTP request traces from Caddy's native access log module and stores them for dashboard charts, live traffic streaming, and historical analysis.

### Architecture

```
Caddy log module → unixgram socket → Ingester → Ring Buffer → Aggregator → SQLite
                                                     ↓
                                              SSE live stream
```

- **Ingester**: reads structured JSON from unixgram socket, parses into traces, applies sampling
- **Ring Buffer**: in-memory circular buffer (default 10K traces), powers live SSE stream and real-time dashboard
- **Aggregator**: computes per-minute stats buckets every 60 seconds, writes raw traces + buckets to persistent store
- **TraceStore**: pluggable persistent backend (SQLite default, ClickHouse/Postgres optional)

### Performance characteristics

- Zero client-visible latency: Caddy logs post-response via Zap (zero-allocation)
- Unixgram socket: fire-and-forget semantics (drops under pressure, never blocks Caddy)
- Pre-aggregated dashboard queries: <10ms regardless of data volume
- Raw trace search: indexed, time-bounded, paginated

## Configuration

```yaml
traces:
  store: sqlite              # sqlite | clickhouse | postgres
  path: /var/lib/rioku/traces  # for embedded stores
  dsn: ""                      # for external stores
  buffer_size: 10000           # ring buffer capacity
  max_size_gb: 50              # disk cap for embedded stores

  retention:
    request_traces: 7d         # individual traces (storage-heavy)
    ai_sessions: 30d           # AI conversation traces
    aggregates: 90d            # pre-computed stats buckets (tiny)

  sampling:
    rate: 1.0                  # 0.0-1.0 (1.0 = 100%)
    ai_always: true            # always trace AI requests
    errors_always: true        # always trace 5xx responses
    min_duration_ms: 0         # always trace requests slower than this (0 = disabled)

  content:
    store_messages: false      # store LLM request/response content
    redact_patterns:
      - '\b\d{4}[-]?\d{4}[-]?\d{4}[-]?\d{4}\b'  # credit cards
      - '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b'  # emails
```

## Capacity Planning

### Raw trace storage at 10% sampling

| RPS | Per day | 7 days | 14 days | 30 days | 90 days |
|-----|---------|--------|---------|---------|---------|
| 10 | 52 MB | 360 MB | 730 MB | 1.6 GB | 4.7 GB |
| 100 | 520 MB | 3.6 GB | 7.3 GB | 16 GB | 47 GB |
| 500 | 2.6 GB | 18 GB | 36 GB | 78 GB | 234 GB |
| 1,000 | 5.2 GB | 36 GB | 73 GB | 156 GB | 467 GB |

### SQLite comfort zone

SQLite performs well up to ~50 GB with proper indexing. Combined with pre-aggregation:

| Retention | Max RPS (SQLite, 10% sampling) |
|-----------|-------------------------------|
| 7 days | ~500 RPS |
| 14 days | ~200 RPS |
| 30 days | ~100 RPS |
| 90 days | ~25 RPS |

Dashboard charts read pre-aggregated buckets (<200 MB at 90 days) — always fast on SQLite.

### Pre-aggregated stats storage

Under 200 MB at 90-day retention regardless of traffic volume.

## Storage Backends

### SQLite (default, embedded)

Zero configuration required. Works out of the box.

Best for: single node, edge, dev/staging, production under the limits above.

Production-proven: Cloudflare D1, Fly.io LiteFS, Rails 8.

### ClickHouse (recommended for scale)

Self-hosted: `docker run -d --name clickhouse clickhouse/clickhouse-server`

```yaml
traces:
  store: clickhouse
  dsn: "clickhouse://localhost:9000/rioku_traces"
```

15-50x compression means 1000 RPS at 90 days fits in ~31 GB.

Best for: production at >100 RPS with >7 day retention.

### PostgreSQL / TimescaleDB

```yaml
traces:
  store: postgres
  dsn: "postgres://user:pass@host:5432/rioku_traces?sslmode=require"
```

TimescaleDB extension recommended for automatic partitioning and compression.

Can share the same Postgres instance as the config store (different database).

## Diagnostics

```
$ rku traces status
Store:            sqlite
Raw traces:       12.4 GB (7 day retention, 847,293 traces)
Stats buckets:    4.2 MB (90 day retention, 129,600 buckets)
AI sessions:      1.1 GB (30 day retention, 3,412 sessions)
Sampling:         10% (errors: always, slow >1s: always, AI: always)
Disk budget:      50 GB max (24.8% used)
```

### Warning indicators

The daemon emits warnings when:
- Trace store exceeds 80% of `max_size_gb`
- Adaptive sampling is active for >5 minutes (traffic spike)
- Query latency for trace search exceeds 2 seconds

### Recommended actions

```
WARN: trace store at 80% of disk budget (40.1 GB / 50 GB)
  → reduce retention: rku config set traces.retention.request_traces 3d
  → reduce sampling:  rku config set traces.sampling.rate 0.05
  → upgrade backend:  set traces.store=clickhouse in rioku.yaml
```

## Cluster Deployments

- Raw traces are node-local. Each node stores traces for its own traffic.
- Pre-aggregated stats can be merged across nodes via gRPC query fan-out.
- NTP synchronization is required for consistent cross-node time-range queries.
- For unified cluster-wide trace visibility, use an external backend that all nodes write to.

## Ephemeral Infrastructure (Kubernetes, Serverless)

Nodes on ephemeral infrastructure lose traces on pod eviction. Options:

1. **SQLite + S3 backup** (recommended): continuous WAL streaming to S3-compatible storage
2. **External database**: ClickHouse or Postgres

The `rku init` wizard warns when it detects ephemeral environments.

## Edge Deployments

SQLite is the ideal edge backend. Single binary, no network dependency, bounded disk usage. Traces are locally useful for debugging even without external connectivity.

## Troubleshooting

### Traces not appearing in dashboard

1. Check ingester is running: look for `tracestore: ingester ready` in daemon log
2. Check Caddy logging config: `curl http://localhost:2019/config/ | jq .logging`
3. Check socket exists: `ls -la /var/lib/rioku/trace.sock`
4. Check sampling config: `rku traces status`

### High drop rate

If `traces_dropped_total` is increasing:
- Increase `buffer_size` (costs memory)
- Reduce `sampling.rate`
- Upgrade to faster storage backend

### Slow dashboard queries

If historical charts load slowly:
- Verify pre-aggregated buckets exist (aggregator must be running)
- Reduce `retention.request_traces` (raw traces are the heavy table)
- Upgrade to ClickHouse for analytical queries
