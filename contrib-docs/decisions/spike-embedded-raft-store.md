# Spike: Embedded Zero-Dependency Clustering

**Date:** 2026-04-06
**Status:** Complete
**Verdict:** GO

---

## Summary

Evaluated hashicorp/raft + bbolt + memberlist + gossip CRDTs + groupcache as an embedded clustering tier for Rioku. All components work, all tests pass with `-race`, and all performance targets are exceeded.

## Benchmark Results

### Raft Config Store (AMD Threadripper 1950X, single-node)

| Metric | Result | Target | Status |
|---|---|---|---|
| Write latency | 212us | <5ms | 24x better |
| Read latency | 9.6us | <1ms | 100x better |
| Write throughput | 4,700/sec | >1,000/sec | 4.7x target |
| Read throughput | 104K/sec | — | — |

### Memberlist Discovery

| Metric | Result |
|---|---|
| 3-node gossip convergence | <2s |
| Failure detection | <5s (tunable) |
| Auto voter add/remove | Works |
| Rejoin cancels removal | Works |

### CRDT Rate Limit Counters

| Metric | Result | Target | Status |
|---|---|---|---|
| Increment (single thread) | 102ns / 10M/sec | >100K/sec | 100x target |
| Increment (32-core parallel) | 559ns / 1.8M/sec | >100K/sec | 18x target |
| Value read | 77ns / 13M/sec | — | — |
| Merge (100 counters) | 16us | — | — |
| Hot-path allocs | 0 | — | — |

### Distributed Response Cache

| Metric | Result | Target | Status |
|---|---|---|---|
| L1 (otter) hit | 139ns | <1us | 7x better |
| Groupcache hit (local) | 931ns | <1ms | Under target |
| Single-flight dedup | 50 reqs -> 1 getter | — | Works |
| 3-node peer fetch | Works | — | 1 getter across 3 nodes |

## Architecture

Three deployment tiers — operators choose at deploy time:

| Tier | Config Store | Shared State | Use Case |
|---|---|---|---|
| Single node | SQLite | In-process | Dev, homelab |
| Embedded cluster (3-7) | Raft + bbolt | Gossip CRDTs + groupcache | Edge, zero-dep |
| Production | Postgres/Galera | Valkey/Redis/KeyDB | High load |

## Dependencies Added

| Dependency | Size Impact | License |
|---|---|---|
| hashicorp/raft v1.7.3 | ~3MB | MPL-2.0 |
| hashicorp/raft-boltdb/v2 | ~0.5MB | MPL-2.0 |
| etcd-io/bbolt v1.4.3 | ~1.5MB | MIT |
| hashicorp/memberlist v0.5.4 | ~2MB | MPL-2.0 |
| groupcache-go/v3 v3.5.0 | ~2MB | Apache-2.0 |
| maypok86/otter v1.2.4 | ~1MB | Apache-2.0 |

All pure Go, no CGo. Total binary impact: ~10MB.

## Complexity Assessment

| Component | LOC | Files |
|---|---|---|
| Raft store driver | ~1,500 | 4 (command, fsm, raft, tx) |
| Memberlist discovery | ~250 | 1 |
| CRDT counters | ~200 | 1 |
| Distributed cache | ~200 | 1 |
| Tests | ~800 | 4 |
| **Total** | **~2,950** | **10** |

## Key Risks Identified and Mitigated

1. **FSM db pointer race during Restore()** — Fixed with `sync.RWMutex` protecting the bbolt db swap
2. **TOCTOU in raft Apply()** — Removed pre-check, rely on raft's authoritative `ErrNotLeader`
3. **CRDT gossip not wired to memberlist** — Integration gap, not a race. Wire during full implementation.

## Recommendation

**Proceed to full implementation.** The embedded tier should be added as a Phase 2 deliverable after core single-node functionality is complete. The `store.Driver` interface already abstracts this cleanly — the raft driver is additive.

### Remaining Work for Production

- Leader forwarding over gRPC (non-leader nodes proxy writes)
- mTLS transport integration with PKI system
- CRDT gossip wiring into memberlist delegate
- Config file support for raft-specific settings in `rioku.yaml`
- Operational CLI commands: `rku cluster status`, `rku cluster remove-peer`
- Chaos testing: network partitions, slow disks, clock skew
