---
title: Glossary
description: Definitions of terms used throughout the Rioku contributor documentation
sidebar_position: 10
---

Definitions are alphabetical. Each entry is precise and cross-referenced where the term overlaps with related concepts.

---

**agent** — An AI agent configuration stored in the daemon. An agent combines a provider, a system prompt, optional tool bindings, and a rate-limit policy. The term refers strictly to the daemon resource; it does not mean an autonomous software agent or an AI coding assistant.

**claim** — A key-value assertion embedded in an authentication token (JWT or API key). Common claims: `sub` (user ID), `roles`, `tenant`, `token_type`. Claims are validated by the auth middleware and attached to the request context.

**control plane** — The set of daemon subsystems that manage configuration and identity: REST gateway, gRPC server, config store, auth, cluster sync, PKI, and settings. Contrast with _traffic plane_.

**dev-mode gate** — A runtime capability check enforced by the daemon that permits development-only operations (such as plugin sideloading) only when the daemon is started with dev mode enabled. Production deployments do not expose sideload endpoints.

**impersonation** — A super-admin capability that allows an operator to act as any user in any tenant for diagnostic or support purposes. Impersonation sessions are audit-logged and flagged in the session claims. The sandboxed super-admin surface (Plan 11) manages this.

**MCP** — Model Context Protocol. An open protocol for connecting language models to external tools and data sources. Rioku exposes an MCP server so AI agents can invoke registered tools against the daemon's data.

**middleware** (daemon resource) — A named configuration object that attaches a Caddy handler (e.g., authentication, header injection, rate limiting) to one or more routes. Middlewares are stored in the config store and compiled into Caddy JSON when routes are built. Do not confuse with Go HTTP middleware functions in `internal/gateway`.

**middleware** (Go HTTP) — A function of type `func(http.Handler) http.Handler` applied in the REST gateway chain. Examples: `AuthMiddleware`, `TenantMiddleware`, `RateLimiter.Middleware`. See [Request Lifecycle](./request-lifecycle.md).

**plugin sideload** — Loading a plugin from a developer-controlled URL (typically a local Vite dev server) rather than from the installed plugin registry. Requires the dev-mode gate. See [Plugin Host](./plugin-host.md).

**principal** — The authenticated entity making a request. A principal may be a human user, a service account, or an API key holder. The principal is identified by the claims in the request's token.

**route** — A Caddy routing rule associating a URL pattern (matcher) with one or more middlewares and an upstream. Routes belong to a service and are stored as daemon resources in the config store.

**sandbox** — The local development environment produced by `make sandbox`. Runs a real daemon at `:7778` with seeded tenants, users, and upstream services. All feature development must validate against the sandbox.

**sandbox-bypass** — A now-retired carve-out that allowed the admin SPA to run against mock data without a daemon. Removed as part of stage-2 completion (Plan 15). All SPA code now requires a live daemon.

**scope** — A permission string that controls what a principal may do. Scopes are carried in claims or derived from role assignments. Examples: `route:write`, `plugin:install`, `super_admin`.

**service** — A named upstream backend registered with Rioku. A service groups one or more upstream addresses, health-check settings, and load-balancing policy. Routes reference services to direct traffic.

**site** — A virtual hosting configuration that binds a hostname (or wildcard) to a set of routes. Sites are tenant-scoped and compiled into Caddy `server` blocks.

**super-admin** — A cross-tenant administrative role that can view and manage all tenants. Super-admin operations bypass tenant isolation and are subject to additional audit logging. Distinct from a tenant admin (who manages only their own tenant).

**tenant** — An isolated organizational unit within a Rioku installation. Each tenant has its own users, roles, services, routes, and AI configuration. Multi-tenancy is enforced by the `TenantMiddleware` in the REST gateway and by tenant-scoped store queries.

**tool** — A callable function registered with an AI agent. Tools are defined as daemon resources and can be bound to agents via tool-bindings. When an agent invokes a tool, the daemon executes the associated logic and returns the result to the model.

**tool-binding** — The association between an agent and a specific tool. A tool-binding records which tools an agent is permitted to call and any per-binding configuration (e.g., parameter overrides).

**traffic plane** — The Caddy child process and its runtime: TLS termination, request routing, upstream proxying, and real-time traffic logs. Contrast with _control plane_.
