# D4: Per-Tenant Caddy Isolation — Stay Single-Caddy in v1

**Date**: 2026-04-30
**Issue**: #163
**Status**: Accepted

## Context

Rioku runs a single Caddy child process per daemon. Every tenant's
routes, services, plugins, TLS certificates, and rate-limit
counters share that one process. The question #163 raises is
whether each tenant should instead get its own isolated Caddy
process — a per-tenant child process with its own admin socket,
its own listeners, and its own resource budget.

The split shows up in three places:

1. **Blast radius.** A misconfigured plugin in tenant A can crash
   the shared Caddy and take every tenant down. Per-tenant
   isolation contains the failure to the offending tenant.
2. **Resource fairness.** A tenant with a runaway upstream
   consumes shared file descriptors, memory, and goroutine slots.
   Per-tenant isolation lets the daemon enforce a quota per
   process.
3. **Configuration surface.** Per-tenant isolation lets each
   tenant pick its own Caddy version, plugin set, and TLS policy
   independently — a real ask from operators who want to A/B-test
   Caddy upgrades.

## Decision

**Stay single-Caddy in v1.** Per-tenant Caddy processes are NOT
implemented. #163 closes as "won't fix in v1; revisit on demand
signal."

The decision rests on three concrete observations.

### Observation 1 — the blast-radius story is overstated

The shared-Caddy failure modes that this is supposed to mitigate
are mostly *not* tenant-isolated regardless. A panic in
`http.handlers.rioku_*` is process-level — even per-tenant Caddy
wouldn't help unless every plugin instance is also process-
isolated. The handlers are bundled into one binary; one panic
crashes that binary's process whether it serves one tenant or
fifty.

The actual blast-radius reductions per-tenant Caddy buys are:

- **TLS handshake failures don't affect other tenants' listeners.**
  Real but small — a misconfigured cert today produces 4xx for the
  matched route, not a daemon outage.
- **Plugin config-load errors are sandboxed.** Already mitigated
  by Caddy's admin-API atomicity: a bad config-push fails closed
  and Caddy keeps running the previous config. No process restart.

### Observation 2 — resource fairness is a config-store problem

The "noisy tenant" failure mode is real but the right fix isn't
process isolation — it's per-tenant resource quotas at the
config-store + rate-limit layers. Sprint 3's rate-limit module
(D11) already supports `tenant_id` scope. Sprint 4's Plans +
Subscriptions adds per-plan rpm/quota enforcement. Sprint 5's
virtual-keys layer adds budget caps. None of these need separate
processes.

The single failure mode that *does* benefit from process
isolation is "tenant A leaks file descriptors" — but the same
fix at OS level (cgroups, ulimits) on the daemon process bounds
the leak whether one or many tenants share it.

### Observation 3 — operational cost is significant

Per-tenant Caddy means:

- **N admin sockets.** Today we have one. With 50 tenants we'd
  have 50 admin endpoints, 50 concurrent admin-API consumers,
  and 50 coordination problems for cross-tenant config changes.
- **N TLS certificate stores.** Caddy's automatic-HTTPS is
  per-process. Per-tenant means N CertMagic instances, N
  on-disk cert directories, N rate-limit budgets against ACME
  providers (Let's Encrypt's per-IP rate is per-IP, not per-
  process — multiple processes sharing an IP compete).
- **N port assignments.** Each Caddy needs its own
  listener ports. With shared :80/:443 and SNI-based routing
  there's only one process that can bind. We'd need either a
  shared front-proxy (re-introducing the "single Caddy" we
  were trying to avoid) or per-tenant external IPs (operationally
  brutal).
- **N config-compile pipelines.** Today the daemon's compiler
  posts one Caddy admin-API payload per change. Per-tenant
  means routing each change to the right process; for cross-
  tenant changes (e.g., a global rate-limit policy update),
  fanning out N posts.

The competitive analysis (`tmp/competitors/SYNTHESIS.md`) is
unanimous: **none of the OSS gateways do per-tenant process
isolation**. Kong, APISIX, Tyk, Gravitee, Traefik all use a
single dataplane process per node. The teams that explored this
in their architecture docs concluded the same — the operational
cost outweighs the blast-radius benefit at the cardinality where
this matters (tens to low hundreds of tenants per node).

## When this decision should be revisited

A specific demand signal would re-open #163:

- A customer materially needs per-tenant Caddy version
  selection (e.g., one tenant requires a Caddy 2.x feature
  that's incompatible with another tenant's plugin set).
- A customer materially needs per-tenant TLS certificate stores
  for compliance reasons (HIPAA / FedRAMP-style isolation
  guarantees that share-nothing process boundaries help with).
- The shared-process failure modes start showing up in
  production telemetry — i.e., we observe noisy-tenant cascades
  that the rate-limit + quota layers can't contain.

Until one of those signals lands, the decision is "stay
single-Caddy."

## Consequences

- **#163 closes.** Tracking issue marked "wontfix in v1, revisit
  on demand signal" with a link to this decision.
- **No code changes.** The compiler keeps posting to one Caddy
  admin socket; routes from every tenant share the listener
  set; TLS automation is shared.
- **Per-tenant resource fairness** is the rate-limit + Plans +
  virtual-keys responsibility (Sprints 3, 4, 5) — not the
  Caddy-process responsibility.
- **Per-tenant blast-radius mitigation** continues to be best-
  effort: structured logging + audit + admin alerts surface
  failures, but a process panic is global. If this becomes a
  pain point, the right fix is panic-handling discipline in
  every plugin (defer/recover at the handler boundary), not
  process isolation.
