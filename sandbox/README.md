# Rioku Sandbox

Self-contained development environment with 5 fake upstream applications for testing and validation. Includes auth system with test users, RBAC roles, smoke test scripts, container support (Podman canonical; Docker supported as fallback), and a unified seed system.

## Quick Start

### Native (requires Go, Node, curl, gettext)

```bash
make sandbox                    # Build + start + seed (rich mode by default)
make sandbox-stop               # Stop all processes
make sandbox-reset              # Wipe data + restart fresh
```

### Containers (requires Podman or Docker)

```bash
make sandbox-container          # Build images + start in containers
make sandbox-container-stop     # Stop containers
make sandbox-container-logs     # Stream container logs
make sandbox-container-clean    # Remove containers, volumes, and local images
```

`make sandbox-container` brings up the full container stack (sandbox apps + daemon + Mailpit + Prometheus + Grafana + OTel + Tempo + Pebble). The `postgres` service in `compose.yaml` is gated by a compose profile and not started by default; to include it, run compose directly with `--profile postgres`:

```bash
cd sandbox && podman-compose --profile postgres --env-file .env.example up --build -d
```

Podman is the canonical engine. The Makefile auto-detects `podman-compose` first and falls back to `docker compose` or `docker-compose`. To force a specific tool:

```bash
COMPOSE_CMD="docker compose" make sandbox-container
```

### Web Admin Development (HMR)

```bash
make sandbox-dev-web            # Start sandbox + Vite dev server on :5173
```

The Vite dev server proxies API calls to the running daemon at `:7778`. Edits to `packages/web/` are reflected instantly without rebuilding.

## Configuration

Copy `sandbox/.env.example` to `sandbox/.env` to customize ports or daemon settings. Scripts load `.env` automatically with the defaults below as fallback.

```bash
cp sandbox/.env.example sandbox/.env
```

| Variable | Default | Description |
| --- | --- | --- |
| `SANDBOX_PORT_REST` | `7778` | Daemon REST API port |
| `SANDBOX_PORT_GRPC` | `7777` | Daemon gRPC port |
| `SANDBOX_PORT_TRAFFIC` | `8443` | Caddy traffic port |
| `SANDBOX_PORT_CADDY_ADMIN` | `2019` | Caddy admin API port |
| `SANDBOX_PORT_USERS` | `9001` | users app port |
| `SANDBOX_PORT_PRODUCTS` | `9002` | products app port |
| `SANDBOX_PORT_WEBHOOKS` | `9003` | webhooks app port |
| `SANDBOX_PORT_AUTH` | `9004` | auth-service app port |
| `SANDBOX_PORT_MEDIA` | `9005` | media app port |
| `SANDBOX_DEV_MODE` | `true` | Enable dev mode in daemon auth config |
| `SANDBOX_RATE_LIMIT_RPM` | `6000` | Auth rate limit (requests per minute) |
| `SANDBOX_RATE_LIMIT_BURST` | `100` | Auth rate limit burst size |
| `SANDBOX_REST_BIND` | `0.0.0.0` | REST API bind address |

To set a custom root password, set `SANDBOX_ROOT_PASSWORD` before running `make sandbox`:

```bash
SANDBOX_ROOT_PASSWORD=MyPassword1! make sandbox
```

If not set, a random password is generated and saved to `sandbox/.data/root-password`.

## Stage-2 Services

Stage-2 containers extend the sandbox with observability, email, and optional SQL persistence:

| Service | Image | Default Port | Env Override |
| --- | --- | --- | --- |
| Mailpit (SMTP) | axllent/mailpit:v1.21 | 11025 | `SANDBOX_PORT_MAILPIT_SMTP` |
| Mailpit (UI) | axllent/mailpit:v1.21 | 18025 | `SANDBOX_PORT_MAILPIT_UI` |
| Postgres (opt) | postgres:16-alpine | 15432 | `SANDBOX_PORT_POSTGRES` |
| Prometheus | prom/prometheus:v3.0.1 | 19090 | `SANDBOX_PORT_PROMETHEUS` |
| Grafana | grafana/grafana:11.4.0 | 13000 | `SANDBOX_PORT_GRAFANA` |
| OTel (gRPC) | otel/opentelemetry-collector-contrib:0.115.1 | 14317 | `SANDBOX_PORT_OTEL_GRPC` |
| OTel (HTTP) | otel/opentelemetry-collector-contrib:0.115.1 | 14318 | `SANDBOX_PORT_OTEL_HTTP` |
| Tempo | grafana/tempo:2.7.0 | 13200 | `SANDBOX_PORT_TEMPO` |
| Pebble (ACME) | letsencrypt/pebble:v2.7.0 | 14000 | `SANDBOX_PORT_PEBBLE_ACME` |
| Pebble (mgmt) | letsencrypt/pebble:v2.7.0 | 15000 | `SANDBOX_PORT_PEBBLE_MGMT` |

**Note**: Default ports use a +10000 shift (e.g., Prometheus on 19090 instead of 9090) to avoid host collisions with native mode services.

### Troubleshooting Port Collisions

If a service port conflicts with existing processes, override the port via `sandbox/.env`:

```bash
# sandbox/.env
SANDBOX_PORT_PROMETHEUS=9091
SANDBOX_PORT_GRAFANA=3001
SANDBOX_PORT_POSTGRES=5433
```

See `sandbox/.env.example` for all available port variables.

## All Make Targets

### Native (Process) Targets

| Target | Description |
| --- | --- |
| `sandbox` | Build all binaries (parallel), start all services, seed data (rich mode) |
| `sandbox-stop` | Stop all sandbox processes (via PID files) |
| `sandbox-reset` | Stop + wipe `sandbox/.data/` + restart fresh |
| `sandbox-clean` | Stop + wipe `sandbox/.data/` (same as reset without restart) |
| `sandbox-status` | Show running/stopped status for each service |
| `sandbox-seed` | Re-apply `sandbox/config/seed.yaml` against running sandbox |
| `sandbox-seed-users` | Alias for `sandbox-seed` |
| `sandbox-restart-daemon` | Rebuild daemon (with web) + restart, apps untouched (~5s) |
| `sandbox-restart-daemon-fast` | Rebuild daemon (skip web) + restart (~3s) |
| `sandbox-restart-daemon-only` | Rebuild + restart daemon only (use alongside `sandbox-dev-web`) |
| `sandbox-dev-web` | Start sandbox + Vite HMR dev server on `:5173` |
| `sandbox-logs` | Stream all service logs, color-coded (Ctrl+C to stop) |
| `sandbox-logs-<name>` | Stream logs for a specific service, e.g. `make sandbox-logs-daemon` |
| `sandbox-test-auth` | Run auth smoke tests (login, logout, RBAC, locked/suspended users) |
| `sandbox-test-smoke` | Run full-stack smoke tests (auth + config CRUD + API keys + audit) |

### Container Targets (Podman/Docker)

| Target | Description |
| --- | --- |
| `sandbox-container` | Build + start sandbox in containers (apps + daemon + Mailpit + Prometheus + Grafana + OTel + Tempo + Pebble) |
| `sandbox-container-stop` | Stop container sandbox |
| `sandbox-container-logs` | Stream container logs |
| `sandbox-container-clean` | Remove containers, volumes, and local images |

PostgreSQL is gated behind a compose profile. To run with Postgres instead of SQLite, invoke compose directly: `cd sandbox && podman-compose --profile postgres --env-file .env.example up --build -d`.

### Load Testing Targets

| Target | Description |
| --- | --- |
| `sandbox-load` | Run standard load profile (requires running sandbox) |
| `sandbox-load-monitor` | Run soak load profile with resource monitoring |
| `sandbox-load-compare` | Compare load results against baseline |

## Logs

```bash
make sandbox-logs               # Stream all service logs (color-coded, Ctrl+C to stop)
make sandbox-logs-daemon        # Stream daemon logs only
make sandbox-logs-users         # Stream users app logs
make sandbox-logs-products      # Stream products app logs
```

Logs are written to `sandbox/.data/logs/<name>.log`. Color-coded output:

- Cyan prefix: daemon
- Green prefix: upstream apps

## Seeding

### Modular Seed Files

The sandbox supports modular per-feature seed files in `sandbox/seed/<feature>.yaml`. Approximately 20 feature-specific YAML files are provided, one per domain area.

The loader uses `rioku seed --dir sandbox/seed`, which walks the directory in alphabetical order, env-substitutes each file, and merges the results: slice fields are appended (later files extend earlier ones) and pointer/singleton fields use last-write-wins semantics.

### Applying Seeds

```bash
make sandbox-seed               # Re-apply seed data from concatenated feature files
# Edit sandbox/seed/*.yaml or sandbox/config/seed.yaml to customize
```

Seed files support env-variable substitution (`${SANDBOX_PORT_USERS:-9001}`) so port changes in `.env` propagate automatically.

## Test Isolation: Snapshot / Restore

The sandbox supports capturing and restoring VM snapshots to isolate test runs:

```bash
# Capture a baseline after initial seeding
make sandbox-baseline           # Start sandbox + run rich seedgen + capture baseline snapshot

# Capture current state at any time
make sandbox-snapshot NAME=mytest  # Save snapshot to sandbox/.data/snapshots/mytest.tar.gz

# Restore to a previous state (wipes current data)
make sandbox-restore SNAPSHOT=mytest  # Restore from sandbox/.data/snapshots/mytest.tar.gz
```

Snapshots are stored in `sandbox/.data/snapshots/<name>.tar.gz` and can be shared between developers for deterministic test reproduction.

## Authentication

The sandbox uses cookie-based session auth. On `make sandbox`, the daemon runs `rioku init` which creates a root user. The root password is saved to `sandbox/.data/root-password` for use by scripts.

After start, the terminal prints the root credentials. To retrieve them later:

```bash
cat sandbox/.data/root-password
```

## Test Users

Seven test users are seeded automatically with different roles and statuses:

| Username | Password | Roles | Status |
| --- | --- | --- | --- |
| testadmin | TestAdmin123! | admin | active |
| testoperator | TestOperator123! | operator | active |
| testviewer | TestView123! | viewer | active |
| testmulti | TestMulti123! | operator, auditor | active |
| test2fa | Test2Factor123! | admin | active (TOTP not configured) |
| testlocked | TestLocked123! | viewer | locked |
| testsuspended | TestSusp123! | viewer | suspended |

These passwords are non-secret — local development sandbox only.

### Login Flow

```bash
# Login (returns session cookie)
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"testadmin","password":"TestAdmin123!"}' \
  http://localhost:7778/api/v1/auth/login

# Authenticated request
curl -b cookies.txt http://localhost:7778/api/v1/config

# Logout
curl -b cookies.txt -X POST http://localhost:7778/api/v1/auth/logout
```

### RBAC Roles

| Role | Permissions |
| --- | --- |
| admin | Full access: config CRUD, user management, session management, audit |
| operator | Config read/write, traffic read — no user management |
| viewer | Read-only access to config and traffic |
| auditor | Custom role: `audit:read` permission only |

## Smoke Tests

```bash
make sandbox-test-auth    # Auth flows only (login, logout, RBAC, locked/suspended)
make sandbox-test-smoke   # Full-stack (auth + config CRUD + API keys + audit)
```

Tests report `[PASS]` / `[FAIL]` per scenario and exit non-zero on any failure. `test-smoke.sh` delegates to `test-auth.sh` internally.

## Development Workflow

### Backend changes

```bash
make sandbox                           # Start sandbox
# ... edit daemon code ...
make sandbox-restart-daemon-fast       # Rebuild + restart daemon (~3s, apps stay up)
make sandbox-test-smoke                # Validate
make sandbox-stop                      # Done
```

### Frontend changes (HMR)

```bash
make sandbox-dev-web                   # Sandbox + Vite HMR on :5173
# Edit packages/web/... — browser updates instantly
# Backend changes: make sandbox-restart-daemon-only in another terminal
```

### Full reset

```bash
make sandbox-reset                     # Wipe .data/ and restart fresh
```

## Architecture

```text
                             ┌─────────────────────────────────┐
  Browser / CLI / Tests ────>│  Rioku Daemon (:${SANDBOX_PORT_REST} REST)        │
                             │  Admin Panel served at /         │
                             └──────────────┬──────────────────┘
                                            │ routes traffic via Caddy (:${SANDBOX_PORT_TRAFFIC})
                   ┌────────────────────────┼──────────────────────────┐
                   v                        v                          v
         ┌──────────────┐        ┌──────────────────┐       ┌──────────────┐
         │ users :${SANDBOX_PORT_USERS}   │        │ products :${SANDBOX_PORT_PRODUCTS}    │       │ media :${SANDBOX_PORT_MEDIA}   │
         └──────────────┘        └──────────────────┘       └──────────────┘
         ┌──────────────┐        ┌──────────────────┐
         │ webhooks :${SANDBOX_PORT_WEBHOOKS}│        │ auth-svc :${SANDBOX_PORT_AUTH}    │
         └──────────────┘        └──────────────────┘
```

Default ports (override via `sandbox/.env`):

- REST API: `:7778`
- gRPC: `:7777`
- Traffic (Caddy): `:8443`
- Upstream apps: `:9001`–`:9005`

## Process Management

Each service runs as a background process tracked by PID file in `sandbox/.data/pids/<name>.pid` with logs in `sandbox/.data/logs/<name>.log`. No screen or tmux required.

```bash
make sandbox-status            # Show running/stopped status for all services
make sandbox-logs              # Stream all logs (color-coded)
make sandbox-logs-daemon       # Stream daemon logs only
make sandbox-clean             # Stop + wipe all sandbox data
```

## Config Template

The daemon config is generated from `sandbox/config/rioku.sandbox.yaml.tmpl` using `envsubst`. Variables from `sandbox/.env` (or the defaults in `start.sh`) are substituted at init time.

Do not edit `sandbox/.data/rioku.yaml` directly — it is a generated file. Edit the template instead and run `make sandbox-reset` to regenerate.

## Seeded Routes

| Route | Host | Path | Upstream | Policies |
| --- | --- | --- | --- | --- |
| users-api | api.local | /v1/users/* | users:9001 | rate-limit-standard, auth-api-key |
| products-api | api.local | /v1/products/* | products:9002 | rate-limit-standard |
| products-search | api.local | /v1/search | products:9002 | rate-limit-strict |
| webhooks-inbound | hooks.local | /* | webhooks:9003 | rate-limit-strict, auth-api-key |
| auth-login | auth.local | /login | auth-service:9004 | rate-limit-strict |
| auth-api | auth.local | /v1/* | auth-service:9004 | rate-limit-standard, auth-api-key |
| media-assets | media.local, cdn.local | /assets/* | media:9005 | — |

## Upstream Apps

| App | Port | Behavior |
| --- | --- | --- |
| users | 9001 | REST CRUD, 1000 pre-seeded users, paginated, connection pool simulation |
| products | 9002 | Catalog + search, 5000 products, heavy payloads, LRU cache, ~2% errors |
| webhooks | 9003 | Async receiver, per-channel queues, backpressure (429 when full) |
| auth-service | 9004 | JWT-like tokens, rate limiting, failed attempt tracking |
| media | 9005 | Blob streaming, Range header support, bandwidth throttling |

All apps accept `-port`, `-max-conns`, `-error-rate`, `-latency-min`, and `-latency-max` flags.

## Data Directory

Runtime data is stored in `sandbox/.data/` (gitignored):

```text
sandbox/.data/
  rioku.yaml          Generated daemon config (from template)
  rioku.db            SQLite database
  root-password       Root user password (written by init)
  init.log            Output from rioku init
  pids/               PID files for each service
  logs/               Log files for each service
  caddy/              Caddy runtime data
  pki/                PKI certificates
  traces/             Trace store
  bin/                Compiled sandbox app binaries
```

## Sandbox Tools

### cert-gen

Located in `sandbox/tools/cert-gen`, this utility generates self-signed CA and leaf certificates for TLS testing:

```bash
make sandbox-certs              # Regenerate CA + leaf certs (stored in sandbox/.data/pki/)
```

The generated certificates are valid for 10 years and are used by Pebble (ACME test server) and Rioku's HTTPS support.

### seedgen

Located in `sandbox/tools/seedgen`, this Go binary generates deterministic fixture data with a seeded random generator:

```bash
make sandbox-seedgen            # Build and run seedgen (outputs to sandbox/.data/seedgen-output)
```

Seedgen produces high-volume realistic test data (users, products, API keys, routes, policies) for performance and integration testing.

## Subdomain mode TLS

For local subdomain testing on `*.localhost`, the sandbox generates a
self-signed CA + wildcard leaf via `make sandbox-certs`. The daemon is
launched with `--subdomain-cert sandbox/certs/wildcard.pem
--subdomain-key sandbox/certs/wildcard.key`, which the Caddy compiler
emits as `apps.tls.certificates.load_files` so Caddy serves the leaf
for any `*.localhost` SNI without ACME.

Install the CA in your OS trust store so browsers and `curl` accept the
leaf:

- macOS: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain sandbox/certs/ca.pem`
- Linux (Debian/Ubuntu): `sudo cp sandbox/certs/ca.pem /usr/local/share/ca-certificates/rioku-sandbox.crt && sudo update-ca-certificates`
- Windows: `certutil -addstore -f "ROOT" sandbox/certs/ca.pem`

Then `https://t1.localhost:7778` resolves with a valid cert.

## Troubleshooting

**Port conflict**: Edit `sandbox/.env` to remap conflicting ports, then `make sandbox-reset`.

**Dependency missing**: `make sandbox` prints which tools are missing (requires: `go`, `curl`, `python3`, `gettext`, `make`).

**Stale processes after crash**: `make sandbox-clean` removes PID files and all runtime data.

**Config out of sync**: `make sandbox-reset` wipes `.data/` and regenerates config from the template.

**Container sandbox not starting**: Ensure Podman or Docker is running. The Makefile auto-detects `podman-compose` or `docker compose`. To use a specific tool: `COMPOSE_CMD="docker compose" make sandbox-container`.
