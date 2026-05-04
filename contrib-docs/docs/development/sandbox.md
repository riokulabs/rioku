# Sandbox

The sandbox is the standard end-to-end validation environment for Rioku
backend development. It runs a single-node Rioku daemon (SQLite store)
with five fake upstream apps and a seeded fixture set covering every
stage-2 entity type. Per `CLAUDE.md` Development Validation, all backend
features and bugfixes must be validated against the sandbox before
merge.

## Quick start

```bash
# First-time setup or after a wipe
SANDBOX_ROOT_PASSWORD=TestRoot1234! make sandbox

# Reset to clean state (wipes .data/, then starts fresh)
SANDBOX_ROOT_PASSWORD=TestRoot1234! make sandbox-reset

# Run smoke tests against a running sandbox
make sandbox-test-smoke

# Stop everything
make sandbox-stop
```

The `SANDBOX_ROOT_PASSWORD` env var is only required on the first
`init` run for a given `.data/` directory; the password is then saved
to `sandbox/.data/root-password` and reused by subsequent commands.

## Make targets

| Target | When to use |
|---|---|
| `make sandbox` | Build + start daemon, upstream apps, seed fixtures. Skips already-running services. |
| `make sandbox-stop` | Stop daemon + upstream apps via PID files; force-kill orphans on the known ports. |
| `make sandbox-reset` | `sandbox-stop` + `rm -rf sandbox/.data` + fresh `sandbox`. Use after schema migrations or seed changes. |
| `make sandbox-restart-daemon` | Rebuild daemon (with web UI) and restart it without touching upstream apps. ~5s. |
| `make sandbox-restart-daemon-fast` | Like above but skips the web build. ~3s. Use when iterating on Go code only. |
| `make sandbox-seed` | Re-apply `sandbox/config/seed.yaml` against a running sandbox. Idempotent; safe to re-run. |
| `make sandbox-status` | Show PID, port, and health for every sandbox process. |
| `make sandbox-logs` | Stream all logs (color-coded). `make sandbox-logs-daemon` streams only the daemon. |
| `make sandbox-test-auth` | Auth-only smoke tests (login, logout, RBAC, locked/suspended). |
| `make sandbox-test-smoke` | Full-stack smoke tests including auth, config CRUD, primitives, tenant isolation, optional OTLP. |
| `make sandbox-test-primitives` | Caddy primitive smoke tests in isolation (request/response headers, compression, response_rules, dynamic upstreams, buffers). Useful for narrow primitive iteration. |
| `make sandbox-clean` | `sandbox-stop` + wipe `.data/`. No restart. |

## Seeded fixtures

`sandbox/config/seed.yaml` is applied on `make sandbox` after the daemon
becomes healthy. Coverage:

- **Roles**: built-in `admin` / `operator` / `viewer` / `superadmin` plus a
  custom `auditor` role.
- **Users** (passwords are non-secret, local-only):
  - `testadmin` / `TestAdmin123!` — `admin` role, member of `default`,
    `acme`, `beta`. Default user for smoke tests.
  - `testoperator` / `TestOperator123!` — `operator` role, member of
    `default` + `acme`.
  - `testviewer` / `TestView123!` — `viewer` role.
  - `testmulti` / `TestMulti123!` — `operator` + `auditor` roles.
  - `test2fa` / `Test2Factor123!` — `admin` role (2FA scaffolding).
  - `testlocked` / `TestLocked123!` — `viewer` role, status `locked`.
  - `testsuspended` / `TestSusp123!` — `viewer` role, status `suspended`.
- **Root**: `root` user; password is generated per-init and stored at
  `sandbox/.data/root-password` (or whatever `SANDBOX_ROOT_PASSWORD`
  was set to on first init).
- **Tenants**: `default` (implicit) plus `acme` (Pro plan) and `beta`
  (Community plan). The `acme-www` site lives only in `acme`; the
  `beta-www` site lives only in `beta` — both are used by the tenant
  isolation smoke test.
- **Upstream services**: `users-upstream`, `products-upstream`,
  `webhooks-upstream`, `auth-upstream`, `media-upstream`. Each maps to
  one of the fake apps in `sandbox/apps/`.
- **Routes**: 10 routes spanning `api.local`, `hooks.local`,
  `auth.local`, `media.local`, `cdn.local`, plus a path-only
  `/healthz` route.
- **Policies**: 4 policies — rate limits (standard + strict), an
  API-key auth policy, and an open CORS policy.
- **Stage-2 entities**: 4 sites, 4 middlewares, 2 dashboards, 3 AI
  providers (OpenAI / Anthropic / Ollama), 3 AI agents, 3 AI tools,
  2 MCP servers, 4 notification channels + 3 routing rules, 3
  plugins (in `building` state — install orchestration is a stage-2
  stub), 2 plugin signers (one global), 2 cert authorities + 2
  enrollments, 2 TLS certificates, 3 webhook endpoints, plus
  singletons for TLS / network / auth-policy / observability /
  audit-retention / notifications.

## Caddy primitive coverage

Sprint 1's Caddy primitives are exercised end-to-end by
`sandbox/scripts/test-primitives.sh` (called from `test-smoke.sh` and
also runnable as `make sandbox-test-primitives`). The seed CLI does not
yet bind the primitive fields on `Service`/`Route`, so the primitives
are POSTed directly through the REST API by the smoke test rather than
written into `seed.yaml`.

| Primitive | What's verified |
|---|---|
| `request_headers` (set/add/delete) | Service compiles a `headers` handler before `reverse_proxy` (round-trip + Caddy admin spot-check). |
| `response_headers` (set/add/delete) | Custom `X-Gateway-Version` / `X-Trace-Hint` returned by traffic plane. |
| `compression` (encode) | `Content-Encoding: gzip` + `Vary: Accept-Encoding` on a response with `Accept-Encoding: gzip`. |
| `response_rules` / `handle_response` | A `serveErrorPage` rule on 404 returns a custom HTML body instead of the upstream's plain-text 404. |
| `dynamic_upstreams` (`a_lookup`) | Service round-trips with an `aLookup` upstream block intact. |
| Upstream `request_buffers` / `response_buffers` | Round-trips through store with the configured byte counts. |

## OTLP log shipping

OTLP shipping is **off by default** so the standard smoke run isn't
gated on the bundled receiver. To enable it:

```bash
SANDBOX_ROOT_PASSWORD=TestRoot1234! \
SANDBOX_OTLP_ENABLED=true \
  make sandbox-reset

SANDBOX_OTLP_ENABLED=true make sandbox-test-smoke
```

When enabled:

1. `start.sh` builds and launches `sandbox/tools/otlp-listener` on
   `:4318` (intake) and `:4319` (status JSON).
2. The rioku.yaml template wires the daemon's OTLP exporter to the
   listener (`http/protobuf`, `insecure: true`, service name
   `rioku-sandbox`).
3. The smoke test's Part 11 reads `http://localhost:4319/__status` to
   verify the listener has received non-zero bytes from the daemon
   exporter.

The listener is intentionally minimal — it counts bytes per request
and never decodes the protobuf payload. That's enough evidence that
the exporter is correctly configured and producing traffic without
pulling in a full Jaeger/Tempo stack.

## Tenant isolation

The smoke test's Part 10 validates the tenant routing surface using the
seeded `default` / `acme` / `beta` tenants:

1. `GET /api/v1/t/nonexistent-tenant/audit?limit=1` -> 404 (proves the
   tenant middleware runs before handler dispatch).
2. `GET /api/v1/t/{slug}/audit` -> 200 for each known slug.
3. `GET /api/v1/t/{slug}/users` -> 200 for each known slug.

Note: per-endpoint membership enforcement varies. Some routes
(`/sites`, `/ai/*`, `/plugins`) gate on per-tenant permissions that the
seeded `admin` role does not currently grant; those tests are skipped
to keep the smoke surface honest. Full RBAC-by-tenant coverage will
arrive when stage-2 admin lands and starts hitting these endpoints.

## Adding a new test surface

When you add a new daemon feature, extend the smoke tests so the
sandbox catches regressions:

1. **REST-only feature** — add a new section to `test-smoke.sh`. Use
   the existing `api_post` / `api_get` helpers and the established
   admin session cookie jar. Keep the section under one heading
   (`Part N: Title`) so the output stays scannable.
2. **Caddy primitive or traffic-plane behaviour** — add to
   `test-primitives.sh`. Each primitive needs a fixture POST + a curl
   against `:8443` (the Caddy traffic port, NOT `:7778` which is the
   admin REST port and falls back to the SPA on unknown paths).
3. **New tenant-scoped endpoint** — extend Part 10 with a per-slug
   probe and a containment check.
4. **New observability target** — pattern after Part 11; add an
   opt-in env var (`SANDBOX_<feature>_ENABLED`) so the default
   smoke run isn't dependent on the new collector being available.

After editing, validate end-to-end:

```bash
make sandbox-restart-daemon-fast   # if you also touched daemon code
make sandbox-test-smoke
```

If you're iterating on a single primitive, `make sandbox-test-primitives`
is faster than the full smoke run.

## Configuration

`sandbox/.env.example` documents every override. The most useful:

| Variable | Default | Purpose |
|---|---|---|
| `SANDBOX_PORT_REST` | `7778` | Daemon REST/admin port. |
| `SANDBOX_PORT_GRPC` | `7777` | Daemon gRPC port (mTLS internally). |
| `SANDBOX_PORT_TRAFFIC` | `8443` | Caddy traffic port — this is what you curl to verify primitives. |
| `SANDBOX_PORT_CADDY_ADMIN` | `2019` | Caddy admin API; useful for `curl :2019/config/` to inspect compiled routes. |
| `SANDBOX_OTLP_ENABLED` | `false` | When `true`, start.sh launches the OTLP listener and the daemon ships logs to it. |
| `SANDBOX_OTLP_PORT` | `4318` | OTLP/HTTP intake port. |
| `SANDBOX_OTLP_STATUS_PORT` | `4319` | OTLP listener status JSON. |
| `SANDBOX_REST_BIND` | `0.0.0.0` | Bind address for the REST listener. |
| `SANDBOX_DEV_MODE` | `true` | Disables CSRF and a handful of session protections — never set in production. |

Override by exporting the variable before any `make sandbox*` call, or
by copying `sandbox/.env.example` to `sandbox/.env` and editing.

## Troubleshooting

**Sandbox won't start — port already in use.**
Check `make sandbox-status`. If a previous run left orphans, run
`make sandbox-stop`; it force-kills anything still on the known ports
via `fuser` / `lsof`.

**Daemon not healthy after start.**
Check `sandbox/.data/logs/daemon.log`. Common causes: a corrupted
SQLite DB after an aborted migration (fix: `make sandbox-reset`), a
port collision (fix: pick a different `SANDBOX_PORT_*` value), or a
seed entity that fails the schema (fix: read the seed log, file an
issue if the schema regressed).

**Smoke test "primitives" section fails on 404.**
The likely cause is a stale `smoke-route` in the SQLite store from a
prior smoke run. The test deletes it as a pre-flight, but if the
delete fails the route may still shadow the primitive routes in
Caddy. Fix: `make sandbox-reset` to wipe the store entirely.

**OTLP test reports 0 bytes.**
Confirm the listener is running: `curl -s http://localhost:4319/__status`.
If the listener didn't start, check that you set `SANDBOX_OTLP_ENABLED=true`
BEFORE `make sandbox` (not before `make sandbox-test-smoke` — start.sh
is the script that conditionally launches the listener and writes the
OTLP block into the daemon yaml).

**Smoke test takes too long.**
Run the focused subsets directly: `bash sandbox/scripts/test-auth.sh`
or `bash sandbox/scripts/test-primitives.sh`. The full
`make sandbox-test-smoke` is the umbrella; individual scripts are
faster.

**Lost the root password.**
It's persisted at `sandbox/.data/root-password` after the first
`init`. If the file is gone, `make sandbox-reset` (which wipes
`.data/`) will mint a fresh one — pass `SANDBOX_ROOT_PASSWORD=...`
to control the value.

## Stage-1 admin carve-out (current)

Per `CLAUDE.md`, the admin panel stage-1 work is exempt from the
sandbox-validation requirement until the `VITE_USE_MOCKS=false` flip
lands. Stage-2 admin work and all backend changes still require
sandbox validation as described above.
