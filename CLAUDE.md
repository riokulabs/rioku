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
  web/             -- SvelteKit admin panel (go:embed into daemon binary)
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
- **Admin panel**: SvelteKit 5 with adapter-static (go:embed)
- **Proto codegen**: buf (buf.build)

## Architecture Principles

- All features ship as modules -- if we can't run lean without a feature, the architecture is wrong
- Config store is source of truth; Caddy admin API is a sync target
- CLI-first; web panel is a parallel interface
- gRPC internally (CLI <-> daemon, node <-> node), REST externally
- Single binary with cobra subcommands; `rku` is a symlink/alias

## Build Commands

```bash
make build-daemon     # Build the rioku binary
make build-service    # Build the build-service binary
make proto            # Generate Go code from proto definitions
make proto-lint       # Lint proto definitions
make test-race        # Run tests with race detector (mandatory before merge)
make web-build        # Build the admin panel SPA
make dev              # Build + run daemon in dev mode
```

## Coding Conventions

- **Go**: Standard library preferred. No ORM (raw SQL per-dialect). No external test libraries.
- **Tests**: Always run with `-race`. Table-driven tests. Real databases for integration tests, not mocks.
- **Errors**: Handle every error explicitly. Never discard.
- **Proto package**: `rioku.v1` with `riokuv1` Go alias
- **Migrations**: Per-dialect directories (sqlite/, postgres/, mysql/). Version numbers kept in sync across all three.
- **Commit format**: Conventional Commits

## Ports (configurable)

- gRPC: `:7777` (internal only, mTLS required)
- REST: `:7778` (external, TLS via Caddy or daemon)
