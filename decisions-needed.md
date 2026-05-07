# Plan 10 — Decisions Needed

All decisions for Plan 10 are now RESOLVED. The cluster section ships its
finished UI surface (nodes list with four stat cards, full-page detail with
Overview/Metrics/Audit tabs, enrollment-tokens page with show-consumed
toggle, sandbox seed bundle). Cross-plan reconciliation work remains for
Plan 13 close-out as noted under D1 / D2 / D4.

## D1: NodeInfo vs ClusterNode shape mismatch — RESOLVED

The daemon's `GET /api/v1/cluster/nodes` endpoint (via `cluster.NodeInfo`) returns
a different shape than the stage-1 mock `ClusterNode` type used in the UI:

| Field | Mock (ClusterNode) | Daemon (NodeInfo) |
|---|---|---|
| status | `healthy/degraded/unreachable/joining/leaving` | `health: healthy/degraded/unhealthy` (enum) |
| role | `primary/replica/witness` | `role: bootstrap/member` (enum) |
| address | `10.0.1.23:7777` | `raftAddr` (optional) |
| version | `0.1.0` | `daemonVersion` |
| joined_at | ISO string | absent (only `lastSeen`) |
| metrics | `{cpu_percent, memory_percent, rps, latency_p95_ms}` | `metrics: map[string]string` (untyped) |

**Resolution:** Stage-2 Plan 10 retains the mock-store data model for tests
(seedStore still seeds `clusterNodes`). The live API layer uses a separate
`DaemonNodeInfo` type adapter that maps NodeInfo → display fields. The full
type migration (removing ClusterNode in favour of V1Node) is **deferred to
Plan 13 close-out** after the `VITE_USE_MOCKS=false` flip. Tracked in
`contrib-docs/admin-stage2-entry.md`.

## D2: Remove node permission discrepancy — RESOLVED

The daemon's `POST /api/v1/cluster/nodes/{id}/remove` requires `cluster:manage`
permission (see `cluster_routes.go:38`). The admin panel permission catalog
defines `cluster:write` and `cluster:enroll`.

**Resolution:** `cluster:manage` was added to the v2 permission catalog in
commit `2d272a43` (`feat(daemon): add cluster:manage permission to v2 catalog`).
The remove-node action in the UI is guarded by `cluster:write` for
backwards compatibility while the daemon gate remains `cluster:manage`.
The `cluster:write` → `cluster:manage` consolidation will land alongside
the Plan 13 mocks-flip.

## D3: Enrollment token response shape — RESOLVED

The daemon's `POST /api/v1/t/{tenant}/cluster/enrollment-tokens` returns:

```json
{
  "id": "...",
  "createdBy": "user-id",
  "expiresAt": "2026-...",
  "consumedAt": null,
  "consumedByNodeId": null,
  "revokedAt": null,
  "notes": "",
  "createdAt": "...",
  "token": "raw-token-hex-only-on-create"
}
```

**Resolution:** Plan 10 adds a `DaemonEnrollmentToken` adapter for the
daemon response, and adapts the UI to use it while keeping the mock store
types for tests. The enrollment-tokens page surfaces all three lifecycle
states (active / consumed / expired) with a "show consumed" toggle that
defaults to active-only.

## D4: Node role terminology — RESOLVED

The daemon uses `bootstrap`/`member` roles (`NodeRole` enum), not
`primary`/`replica`/`witness` from stage-1. The UI shows
primary/replica/witness badges via a display adapter today. **Full
reconciliation deferred to Plan 13** as part of the same removal of the
ClusterNode mock type.
