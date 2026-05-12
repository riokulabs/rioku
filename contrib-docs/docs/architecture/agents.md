---
sidebar_position: 1
---

# Daemon Components

This page describes the internal components of the Rioku daemon — the long-running Go binary that manages Caddy, serves the admin API, and owns all configuration state. These are architectural components of the software, not AI assistants.

For a visual overview of how these components connect, see the architecture diagrams (D3).

---

## Gateway

**Responsibility:** Serves the REST API by translating HTTP+JSON to gRPC using grpc-gateway. It is a thin translation layer with no business logic; gRPC streams are bridged to SSE for the admin panel.

**Package:** `github.com/riokulabs/rioku/internal/gateway`

**Key types:** `Gateway`, `RateLimiter`

**Where to add features:**
- New REST endpoints: add a handler file following the `*_routes.go` pattern in `internal/gateway/`.
- New middleware (auth, rate-limit, RBAC): add to `route_middleware_order.go` and document the order.
- SSE streams: add to `sse.go`.

---

## Store

**Responsibility:** Persists all configuration, RBAC state, audit log entries, and session data. Provides a backend-agnostic `Driver` interface with implementations for SQLite, Postgres, and MySQL/MariaDB (including Galera). All mutations run inside transactions.

**Package:** `github.com/riokulabs/rioku/internal/store`

**Key types:** `Driver` (interface), `Tx` (interface), `DriverConfig`

**Where to add features:**
- New config entities: add methods to the `Driver` interface, implement across all three dialect packages (`store/sqlite`, `store/postgres`, `store/mysql`), add migrations to all three dialect migration directories in sync.
- Audit log entries: use `internal/store/audit` helpers; do not write to the audit table directly from handlers.

---

## Caddy Supervisor

**Responsibility:** Manages the Caddy child process lifecycle (start, stop, restart) and translates daemon config into a Caddy JSON config pushed via the Caddy admin API. Also bridges Caddy stdout/stderr into the daemon's structured logger.

**Package:** `github.com/riokulabs/rioku/internal/caddy`

**Key types:** `Manager`, `ManagerConfig`, `Compiler`

**Where to add features:**
- New Caddy config sections: extend `compiler.go` (or the relevant `compiler_*.go` sub-file) to emit the new JSON block.
- New Caddy admin API calls: add a method to `Manager` that hits the Caddy admin HTTP API via `httpClient`.
- Log routing changes: see `internal/daemon/log_multi_handler.go`.

---

## Cluster Sync

**Responsibility:** Tracks node membership via gossip (memberlist), propagates config deltas between nodes using a CRDT-based sync layer, and exposes a `Service` interface the REST gateway uses to list nodes and report cluster health. Single-node deployments use `LocalOnlyService`, which reports the running daemon as the sole member.

**Package:** `github.com/riokulabs/rioku/internal/cluster`

**Key types:** `Service` (interface), `LocalOnlyService`, `Discovery`, `NodeInfo`, `NodeRole`

**Sub-packages:** `internal/cluster/crdt` (delta propagation), `internal/cluster/raft` (embedded Raft store, optional)

**Where to add features:**
- New per-node metadata surfaced in the admin panel: extend `NodeInfo` in `service.go` and update the `Discovery` implementation.
- Cross-node config replication: work in `internal/cluster/crdt`; changes here must be tested against the store-matrix CI job.

---

## Plugin Host

**Responsibility:** Registers plugin manifests, validates capability declarations, enforces per-plugin permissions, and manages the plugin runtime lifecycle. Supports two modes: production plugins (compiled WASM or Go shared objects) and development sideload (hot-reload for the admin SPA plugin API).

**Package:** `github.com/riokulabs/rioku/internal/plugin`

**Key types:** `Host` (in `host.go`)

**Sub-packages:** `internal/plugin/wasm` (WASM runtime bindings)

**Where to add features:**
- New plugin capability: define the capability constant and add enforcement to the host's permission check path in `host.go`.
- New sideload endpoint: add to the gateway's sideload route group (`internal/gateway/sideload_routes_test.go` documents the contract).

---

## AI Router (AI Gateway)

**Responsibility:** The daemon's policy enforcement point for AI requests. Resolves the inbound virtual key, selects an upstream provider via the configured routing strategy, vault-resolves the upstream credential, reverse-proxies the request, and emits a spend-log entry. Runs as a separate HTTP server on a loopback address (default `127.0.0.1:7792`); Caddy edge-proxies to it after auth.

**Packages:**
- `github.com/riokulabs/rioku/internal/aigateway` — HTTP server and proxy logic
- `github.com/riokulabs/rioku/internal/ai/registry` — model price and capability registry (vendored LiteLLM data + Rioku overlays)
- `github.com/riokulabs/rioku/internal/ai/router/strategies` — routing strategy registry
- `github.com/riokulabs/rioku/internal/tracestore` — request trace ring buffer + persistent store
- `github.com/riokulabs/rioku/internal/mcp` — MCP (Model Context Protocol) server exposing daemon capabilities as tools

**Key types:** `aigateway.Server`, `registry.Registry`, `strategies.Registry`, `tracestore.Driver` (interface), `tracestore.Ingester`

**Where to add features:**
- New routing strategy: implement the `strategies.Strategy` interface and register it in the `strategies` package.
- New model pricing data: update `ai/registry`; do not hard-code prices in handler code.
- New MCP tool: add to `internal/mcp/`; follow the existing tool registration pattern.
- Trace schema changes: add a migration to `internal/tracestore/sqlite/` (only SQLite today; schema changes must keep ring-buffer and DB in sync).

---

## Settings and Identity

**Responsibility:** Owns authentication (sessions, JWTs, TOTP, SSO/OIDC, password lifecycle), RBAC (roles, permissions, scopes), API key management, multi-tenancy, and super-admin impersonation. These are not independent services — they are packages consumed by the gateway and the store.

**Packages:**
- `github.com/riokulabs/rioku/internal/auth` — session creation, JWT signing/validation, TOTP, password hashing, RBAC scope resolution
- `github.com/riokulabs/rioku/internal/keyring` — credential storage backends (OS keyring, env, file)
- `github.com/riokulabs/rioku/internal/vault` — virtual-key-to-credential resolver used by the AI router
- `github.com/riokulabs/rioku/internal/pki` — certificate authority for internal mTLS

**Key types:** `auth.SessionClaims`, `auth.Manager` (session store), `vault.Resolver`

**Where to add features:**
- New RBAC permission: add the scope constant to `internal/auth/scopes.go`, add a store migration that seeds it, add RBAC middleware enforcement at the relevant gateway route.
- New auth method (e.g. new SSO provider): implement in `internal/gateway/sso_routes.go`; JWT issuance and session creation go through `internal/auth`.
- New keyring backend: implement the `keyring.Backend` interface; register in `keyring/keyring.go`.
