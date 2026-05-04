# D11: Rate-Limit Counter Coherence — In-Memory + SQLite Flush by Default, Redis as Opt-In

**Date**: 2026-04-30
**Issue**: #180
**Status**: Accepted

## Context

Sprint 3 ships an in-tree token-aware rate-limit Caddy module
(`caddy/modules/rioku-ratelimit/`) that replaces the third-party
`caddy-ratelimit`. Rate-limit counters are read and written on every
data-plane request; the storage layer dominates latency and scalability.

Three viable patterns:

1. **In-memory `sync.Map`, periodic flush to SQLite.** Lock-free hot
   path. Counters survive daemon restart via the flush. Cross-node
   coherence is approximate — each node tracks its own counters and
   flushes its own slice. Acceptable for single-node deployments and
   small clusters where soft enforcement is fine.

2. **Redis (or Valkey).** Shared counters across all nodes. Exact
   enforcement at any cluster size. Adds an external dependency and a
   network round-trip on the hot path (typical 100-500 µs vs. ~50 ns
   for the in-memory path).

3. **Embedded gossip CRDT counters.** PN-Counter over memberlist
   (validated in the 2026-04-06 spike at 10M increments/sec). Eventually
   consistent; useful for soft limits but cannot enforce hard cutoffs
   precisely under burst.

## Decision

**Default to in-memory `sync.Map` + periodic flush to SQLite.** Redis
is opt-in and selected per route via the `storage` field on the
rate-limit handler config.

In-memory + SQLite is the right default because:

- The single-binary, zero-external-dependency story is core to Rioku's
  positioning. Forcing Redis on day one breaks that story.
- Most deployments are single-node. Counters that survive restart on
  the same node are sufficient.
- SQLite flush gives us cross-restart persistence at near-zero cost
  (counters are tiny, flush interval is ~5s).

Redis is the right opt-in because:

- Multi-node deployments that need exact, shared enforcement (e.g.,
  per-API-key burst protection on a 3+ node cluster) cannot use
  per-node counters without losing exactness.
- Operators already running Valkey (per the 2026-04-02 decision) for
  shared cache/state can reuse it without a second external store.

CRDT counters are explicitly **rejected** for v1. Approximate counters
are useful for "log/observe" actions but not for "block" enforcement.
We can revisit if a customer materially needs a CRDT-grade soft tier.

## Consequences

- The rate-limit module exposes a `storage` enum with values `mem`
  (default) and `redis`. New backends require a code change, not a
  config-only switch.
- The `mem` backend writes counter snapshots to a `rate_limit_counters`
  table in the config store. Migration ships in Sprint 3.
- The `redis` backend assumes Valkey/Redis ≥ 6 with `INCR` + `EXPIRE`.
  Connection config follows the existing Valkey adapter shape (see
  `internal/cache/`).
- Cross-node coherence with `mem` is best-effort and is documented as
  such on the route's audit trail. Operators choosing `mem` on a
  multi-node cluster see a structured warning at compile time.
- Counter scopes (`key`, `ip`, `route_id`, `tenant_id`, custom CEL)
  are storage-agnostic — both `mem` and `redis` implement the same
  `CounterStore` interface.
