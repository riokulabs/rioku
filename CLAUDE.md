# Rioku

Open-source, AI-native API gateway platform built on Caddy. No feature paywalls.

## Project Identity

- **Name**: Rioku (previously called Revyn / CaddyGateway in design docs)
- **CLI binary**: `rioku`
- **CLI alias**: `rku`
- **GitHub org**: `riokulabs`
- **Module path**: `github.com/riokulabs/rioku`

## Monorepo Layout

```
packages/
  daemon/          -- Go module: core daemon binary (cmd + internal + pkg)
  proto/           -- Protobuf definitions + buf config (generates Go + OpenAPI)
  web/             -- React admin panel (go:embed into daemon binary)
  build-service/   -- Separate Go binary for hosted xcaddy builds
  plugins/         -- First-party plugin modules (rate-limit, auth, LLM proxy, etc.)
docs/              -- User-facing documentation
contrib-docs/      -- Contributor documentation
tmp/               -- Working design documents (not committed)
```

## Tech Stack

- **Primary language**: Go 1.24+
- **Traffic engine**: Caddy (managed child process, NOT forked)
- **Internal API**: gRPC (protobuf, buf toolchain)
- **External API**: REST via grpc-gateway (thin translation layer, no business logic)
- **Live events**: SSE (translated from gRPC server-streaming at REST layer)
- **Config store**: SQLite (default), Postgres, MySQL/MariaDB (Galera for HA)
- **Admin panel**: React 19 + TanStack Router/Query, Vite (go:embed)
- **Proto codegen**: buf (buf.build)

## Architecture Principles

- All features ship as modules -- if we can't run lean without a feature, the architecture is wrong
- Config store is source of truth; Caddy admin API is a sync target
- CLI-first; web panel is a parallel interface
- gRPC internally (CLI <-> daemon, node <-> node), REST externally
- Single binary with cobra subcommands; `rku` is a symlink/alias

## Build Commands

**Always use `make` targets for building — never raw `go build`.** The Makefile outputs binaries to `bin/` with proper ldflags. Running `go build` directly drops binaries in the working directory.

```bash
make build-daemon     # Build the rioku binary -> bin/rioku
make build-service    # Build the build-service binary -> bin/rioku-build-service
make proto            # Generate Go code from proto definitions
make proto-lint       # Lint proto definitions
make test-race        # Run tests with race detector (mandatory before merge)
make web-build        # Build the admin panel SPA
make dev              # Build + run daemon in dev mode
```

## Git Practices

- **Branching**: Feature branches + PRs for all changes. Direct main commits acceptable during early solo development only.
- **Commits**: Conventional Commits required (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`). No AI tool references in commit messages (no `Co-Authored-By` AI lines, no mentions of claude/anthropic/copilot/ai).
- **Merging**: Squash merge always. One clean commit per PR.
- **Signing**: Commits must be signed (SSH or GPG).
- **CI**: All checks must pass before merge.
- **Planning**: All work tracked in GitHub Projects/Issues. Bugs, features, and roadmap items managed in the open at the `riokulabs` org level.

## Test execution contract

**Tests run in PR CI, not in git hooks.** This is deliberate; see `contrib-docs/docs/decisions/2026-04-30-test-execution-and-sandbox-cadence.md`.

| Layer | Runs | Authoritative? |
| --- | --- | --- |
| `pre-commit` | gofmt + goimports auto-fix on staged Go; per-touched-module `go vet`; `buf lint` on staged proto; `eslint --fix` on staged TS in `packages/web` and `packages/ui`. < 5s typical | No — advisory |
| `pre-push` | `go vet ./...` smoke on `packages/daemon` + `packages/build-service`. < 3s typical | No — advisory |
| **PR CI** | Full `go test -race`, `store-matrix-*` (5 required), `golangci-lint`, gofmt/goimports drift check, `buf lint`, `cspell`, full web (lint + typecheck + format + Vitest + Playwright + bundle/ABI), `test-e2e` (sandbox smoke + Playwright) | **Yes — blocks merge** |

Hooks are opt-in via `make hooks`. Full reference: `contrib-docs/docs/development/hooks.md`.

## Sandbox refresh cadence

Per the same decision doc: sandbox seed + smoke harness must be refreshed **at every sprint tie-off**, **on every schema migration**, and **on every new Caddy primitive**. The PR author owns the matching sandbox update; reviewers reject schema/primitive changes that don't include it.

## Coding Conventions

- **Go**: Standard library preferred. No ORM (raw SQL per-dialect). No external test libraries.
- **Tests**: Always run with `-race`. Table-driven tests. Real databases for integration tests, not mocks. **Every feature and bugfix must include tests** — Go unit/integration tests for backend changes, Vitest tests for frontend logic, Playwright E2E tests for user-facing behavior. Contract tests (`contract_test.go`) must be updated when REST API response shapes change. No code ships without corresponding test coverage.
- **Errors**: Handle every error explicitly. Never discard.
- **Proto package**: `rioku.v1` with `riokuv1` Go alias
- **Migrations**: Per-dialect directories (sqlite/, postgres/, mysql/). Version numbers kept in sync across all three.
- **Commit format**: Conventional Commits

## Development Validation — Sandbox Required

**All feature development MUST be validated through the sandbox.** The sandbox (`make sandbox`) provides a running Rioku instance with 5 upstream apps, seeded config, and test users. It is the standard environment for:

- Manual testing during development
- Automated smoke tests (`make sandbox-test-smoke`)
- E2E browser tests (Playwright)
- Load/performance testing

**Development workflow:**
1. `SANDBOX_ROOT_PASSWORD=TestRoot1234! make sandbox` — start full environment (or `make sandbox-reset` for fresh)
2. Write code → `make sandbox-restart-daemon` — rebuild + restart daemon (skips web rebuild if unchanged)
3. `make sandbox-status` — check what's running
4. Validate against `localhost:7778` (curl, browser, smoke scripts)
5. `make sandbox-stop` when done

**If the sandbox is broken, fix it before doing anything else.** A broken sandbox means you cannot validate your work. Do not skip sandbox validation and do not test against ad-hoc manual setups.

**Active exception — admin panel stage 1.** The Mantine admin rebuild on `feat/admin-mantine` ships stage 1 as an in-browser UI/UX/IA mock. It explicitly bypasses the sandbox for the mock stage. See `tmp/specs/2026-04-18-admin-mantine-design.md` §13.0 for the carve-out rules. Sandbox discipline resumes at stage 2 when the admin starts hitting real daemon endpoints.

**Admin stage-1 status (2026-04-20): COMPLETE.** Branch `feat/admin-mantine` has 604 total commits vs `main`. All 9 plans delivered per `tmp/plans/2026-04-18..2026-04-20-*.md`:

- Plan 1 (Foundation), Plan 2 (Sites + API management), Plan 3 (AI management), Plan 4 (Analytics + dashboard builder), Plan 5 (Audit extended), Plan 6 (Plugins polish), Plan 7 (Notifications), Plan 8 (Settings polish), Plan 9 (Stage-1 integration close-out)

Test coverage at stage-1 close: ~1671 unit tests, ~86 a11y tests + 32 visual checks, ~80 E2E smoke tests passing (all mock-store backed). Bundle audit documented in `packages/web/BUNDLE_AUDIT.md`.

**Stage-2 entry points** (not yet flipped):

- `src/api/mode.ts` — flip from mock fetch to real fetch
- `VITE_USE_MOCKS=false` env flag activates real daemon endpoints
- See `contrib-docs/admin-stage2-entry.md` (Task 9c.11) for full migration checklist

**The sandbox-bypass carve-out REMAINS in effect** until the `VITE_USE_MOCKS=false` flip occurs. Stage 2 will retire this exception per spec §13.0.

## Issue Tracking

**Always reference GitHub issue numbers in plans, specs, and commit messages.** When writing implementation plans or specs, include the issue number(s) being addressed (e.g., `#68`, `#79`). This ensures work can be traced back to issues and issues can be closed promptly when the work lands — not discovered as stale months later. When completing work:

1. Close the completed issue with a comment referencing the relevant commits.
2. Check parent/tracking issues (e.g., `#87`, `#88`–`#96`) — if the completed issue appears in a tracking checklist, check it off by editing the tracking issue body.
3. If all items in a tracking issue are checked off, close the tracking issue too.

## Spec Review Checklist

**Every spec must pass these checks before implementation begins.** These are not optional — they catch real bugs that surface during implementation or in production.

### 1. Trace every interface change to all callers
If you change a function signature, struct, or interface: `grep` for every call site. List them all in the spec with the planned change for each. "All implementations updated" is not sufficient — enumerate them.

### 2. Follow data through its full lifecycle
For every new field or value: trace it from creation → storage → retrieval → use → deletion. Ask: what happens when this value is used for authorization? What happens when the entity that owns it is deleted? What happens during data migration from an older schema?

### 3. Check dependencies before proposing them
Run `grep` on `go.mod` (or `package.json`) before proposing a new dependency. If an equivalent is already in the dependency tree, use it. If you must add a new one, say so explicitly.

### 4. Think about failure modes for every I/O operation
For file writes, network calls, multi-writer patterns: what happens when it fails? Does the failure propagate and break something unrelated? Design for partial failure — especially for "best effort" operations like logging.

### 5. Validate security boundaries end-to-end
If adding permissions: can the user bypass them via another path? If accepting user input: where does that input end up? Trace it to every consumer. Check for privilege escalation — can a lower-privilege user craft input that grants higher privileges elsewhere?

### 6. Check for behavioral changes in bridged/compatibility code
If bridging old APIs to new ones (e.g., `slog.SetDefault` bridging `log.Printf`): verify the exact semantics. What level do bridged calls get? What fields are lost? Does partial migration create an inconsistent state?

### 7. Verify sandbox and seed data compatibility
Will the change break the sandbox? Do seeded users/roles have the permissions needed for the new behavior? Will existing smoke tests pass?

## Superpowers

- **Plans**: Save to `tmp/plans/YYYY-MM-DD-<feature-name>.md` (git-ignored)
- **Specs**: Save to `tmp/specs/YYYY-MM-DD-<feature-name>.md` (git-ignored)

## Database test env vars

Integration tests for the config store require a live database. All three variables are **skip-on-unset** — if the variable is absent the test file skips cleanly, so a plain `go test ./...` always passes without any external databases.

| Variable | Format | Purpose |
| --- | --- | --- |
| `POSTGRES_TEST_DSN` | `postgres://user:pass@host:port/db?sslmode=disable` | Postgres integration tests |
| `MYSQL_TEST_DSN` | `user:pass@tcp(host:port)/db?parseTime=true&loc=UTC&multiStatements=false` | MySQL / MariaDB integration tests |
| `GALERA_TEST_DSNS` | comma-separated list of the above format | Multi-node Galera tests (3+ DSNs recommended) |

### CI job names

Branch protection should require all five jobs. The sixth is non-blocking.

| Job name | Required? |
| --- | --- |
| `store-matrix-sqlite` | Yes |
| `store-matrix-postgres-15` | Yes |
| `store-matrix-postgres-18` | Yes |
| `store-matrix-mysql-8-4` | Yes |
| `store-matrix-mariadb-11-4` | Yes |
| `store-matrix-mariadb-11-8` | Optional (non-blocking) |

See `contrib-docs/docs/development/store-test-matrix.md` for the full env-var contract.

## Ports (configurable)

- gRPC: `:7777` (internal only, mTLS required)
- REST: `:7778` (external, TLS via Caddy or daemon)
