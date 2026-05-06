# Plan 10 — Decisions Needed

## D1: NodeInfo vs ClusterNode shape mismatch (resolved inline)

The daemon's `GET /api/v1/cluster/nodes` endpoint (via `cluster.NodeInfo`) returns a different
shape than the stage-1 mock `ClusterNode` type used in the UI:

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
type migration (removing ClusterNode in favour of V1Node) is deferred to
Plan 13 close-out after VITE_USE_MOCKS flip.

## D2: Remove node permission discrepancy (resolved inline)

The daemon's `POST /api/v1/cluster/nodes/{id}/remove` requires `cluster:manage`
permission (see `cluster_routes.go:38`). The admin panel permission catalog
defines `cluster:write` and `cluster:enroll` but NOT `cluster:manage`.

**Resolution:** The remove-node action in the UI is guarded by `cluster:write`
(existing permission). The daemon gate is `cluster:manage`. Before stage-2 can
go live with real endpoints, `cluster:manage` must either be added to the
permission catalog or the daemon gate changed to `cluster:write`. Filed as
a cross-plan dependency for Plan 13 close-out.

## D3: Enrollment token response shape (resolved inline)

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

The stage-1 mock `ClusterEnrollmentToken` shape is different (uses `token` as
the bearer value, no `notes`, no `revokedAt`). Plan 10 adds a `DaemonEnrollmentToken`
type for the daemon response, and adapts the UI to use it while keeping the
mock store types for tests.

## D4: Node role terminology

The daemon uses `bootstrap`/`member` roles (`NodeRole` enum), not
`primary`/`replica`/`witness` from stage-1. The UI currently shows
primary/replica/witness badges. Plan 10 adds a display adapter. Full
reconciliation in Plan 13.
