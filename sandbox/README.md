# Rioku Sandbox

Self-contained environment with 5 fake upstream applications for development and testing. Includes auth system with test users, RBAC roles, and smoke test scripts.

## Quick Start

```bash
make sandbox          # Build + start everything + seed config + seed test users
make sandbox-stop     # Stop all processes (screen sessions + background PIDs)
make sandbox-seed     # Re-seed config without restart
make sandbox-seed-users  # Re-seed test users (idempotent)
```

## Architecture

```text
┌─────────────┐     ┌──────────────────────────────┐
│  Browser /   │────>│  Rioku Daemon (:7778 REST)   │
│  CLI / Tests │     │  Admin Panel served at /      │
└─────────────┘     └──────────┬───────────────────┘
                               │ routes traffic to:
              ┌────────────────┼────────────────────┐
              v                v                     v
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

```text
-port           Listen port (default: varies)
-max-conns      Max concurrent connections (default: 100)
-error-rate     Error percentage 0-100 (default: varies)
-latency-min    Min response latency (default: varies)
-latency-max    Max response latency (default: varies)
```

## Authentication

The sandbox uses cookie-based session auth. On first start (`make sandbox`), the daemon runs `rioku init` which creates a root user with a generated password. The password is saved to `sandbox/.data/root-password`.

### Root Credentials

After `make sandbox`, the terminal prints the root username and password. The password is also saved to `sandbox/.data/root-password` for use by scripts.

### Test Users

Seven test users are seeded automatically with different roles and statuses:

| Username | Password | Roles | Status |
|----------|----------|-------|--------|
| testadmin | TestAdmin123! | admin | active |
| testoperator | TestOp123! | operator | active |
| testviewer | TestView123! | viewer | active |
| testmulti | TestMulti123! | operator, auditor | active |
| test2fa | Test2FA123! | admin | active (TOTP not enabled) |
| testlocked | TestLocked123! | viewer | locked |
| testsuspended | TestSusp123! | viewer | suspended |

These passwords are non-secret -- local development sandbox only.

### Login Flow

```bash
# Login (returns session cookie)
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"testadmin","password":"TestAdmin123!"}' \
  http://localhost:7778/api/v1/auth/login

# Authenticated request (use session cookie)
curl -b cookies.txt http://localhost:7778/api/v1/config

# Logout (clears session)
curl -b cookies.txt -X POST http://localhost:7778/api/v1/auth/logout
```

### RBAC Roles

| Role | Permissions |
|------|-------------|
| admin | Full access: config CRUD, user management, session management, audit |
| operator | Config read/write, traffic read -- no user management |
| viewer | Read-only access to config and traffic |
| auditor | Custom role: audit:read permission |

The viewer cannot create users or modify config. The operator cannot manage users or sessions. Use the smoke tests to validate these boundaries.

## Smoke Tests

```bash
make sandbox-test-auth    # Auth flows only (login, logout, RBAC, locked/suspended)
make sandbox-test-smoke   # Full-stack (includes auth + config CRUD + API keys + audit)
```

The smoke tests report `[PASS]` / `[FAIL]` for each scenario and exit non-zero if any test fails. `test-smoke.sh` delegates to `test-auth.sh` internally, so running smoke includes all auth tests.

## Development Workflow

```bash
make sandbox                   # Start full environment
# ... edit daemon code ...
make sandbox-restart-daemon    # Rebuild + restart daemon only (~5s, apps stay running)
make sandbox-test-smoke        # Validate changes
make sandbox-stop              # Done for the day
```

`sandbox-restart-daemon` requires `screen` (used for process management). If screen is not installed, do a full `make sandbox-stop && make sandbox` cycle.

## Process Management

The sandbox uses `screen` sessions when available (recommended). Each process runs in its own named session:

```bash
screen -ls                    # List all sandbox sessions
screen -r rioku-daemon        # Attach to daemon session (Ctrl-A D to detach)
screen -r rioku-users         # Attach to users-svc session
```

If `screen` is not installed, processes run as background jobs with PIDs tracked in `sandbox/.data/pids`.

## Seeded Routes

| Route | Host | Path | Upstream | LB Policy |
|-------|------|------|----------|-----------|
| users-api | api.local | /v1/users/* | users:9001 | round-robin |
| products-api | api.local | /v1/products/* | products:9002 | random |
| webhooks | hooks.local | /* | webhooks:9003 | first |
| auth | auth.local | /* | auth-service:9004 | least-conn |
| media | media.local | /* | media:9005 | first |

## Data Directory

Runtime data (SQLite DB, PID files, logs, root password, test user state) stored in `sandbox/.data/` (gitignored).
