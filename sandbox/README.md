# Rioku Sandbox

Self-contained environment with 5 fake upstream applications for development and testing.

## Quick Start

```bash
make sandbox          # Build + start everything + seed config
make sandbox-stop     # Stop all processes
make sandbox-seed     # Re-seed config without restart
```

## Architecture

```
┌─────────────┐     ┌──────────────────────────────┐
│  Browser /   │────▶│  Rioku Daemon (:7778 REST)   │
│  CLI / Tests │     │  Admin Panel served at /      │
└─────────────┘     └──────────┬───────────────────┘
                               │ routes traffic to:
              ┌────────────────┼────────────────────┐
              ▼                ▼                     ▼
     ┌──────────────┐ ┌──────────────┐     ┌──────────────┐
     │ users :9001  │ │products :9002│ ... │ media :9005  │
     └──────────────┘ └──────────────┘     └──────────────┘
```

## Upstream Apps

| App | Port | Pattern | Key Behavior |
|-----|------|---------|-------------|
| users | 9001 | REST CRUD | 1000 pre-seeded users, paginated, connection pool sim |
| products | 9002 | Catalog + search | 5000 products, heavy payloads, LRU cache, ~2% errors |
| webhooks | 9003 | Async receiver | Per-channel queues, backpressure (429 when full) |
| auth-service | 9004 | Token auth | JWT-like tokens, rate limiting, failed attempt tracking |
| media | 9005 | Blob streaming | Large files, Range header, bandwidth throttling |

## Common Flags (all apps)

```
-port           Listen port (default: varies)
-max-conns      Max concurrent connections (default: 100)
-error-rate     Error percentage 0-100 (default: varies)
-latency-min    Min response latency (default: varies)
-latency-max    Max response latency (default: varies)
```

## Seeded Routes

| Route | Host | Path | Upstream | LB Policy |
|-------|------|------|----------|-----------|
| users-api | api.local | /v1/users/* | users:9001 | round-robin |
| products-api | api.local | /v1/products/* | products:9002 | random |
| webhooks | hooks.local | /* | webhooks:9003 | first |
| auth | auth.local | /* | auth-service:9004 | least-conn |
| media | media.local | /* | media:9005 | first |

## Credentials

After `make sandbox`, the terminal prints:
- Admin API key for REST/admin panel access
- Monitoring read-only key

## Data Directory

Runtime data (SQLite DB, PID files, logs) stored in `sandbox/.data/` (gitignored).
