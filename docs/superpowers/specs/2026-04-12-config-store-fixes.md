# Config Store Fixes: policyIds Lifecycle, Labels Round-Trip, Deletion Cleanup

**Date**: 2026-04-12 (revised)
**Scope**: Config engine and store drivers -- policyIds wiring, labels bug, deletion orphan cleanup, ImportConfig fix
**Affected drivers**: sqlite, raft (postgres and mysql are empty stubs -- package declaration only, no implementation)

---

## Problem

Three related bugs in the config store flow, plus one in ImportConfig:

### 1. policyIds silently dropped on create and update

The Route proto message has `repeated string policy_ids = 6` and the schema has a `policy_bindings` junction table with full CRUD on the `Tx` interface (`AttachPolicy`, `DetachPolicy`, `ListPoliciesByTarget`). However, the config engine never calls these methods. Routes created or updated with `policyIds` return 200, but the junction table is never populated. The read path (`buildSnapshot` in `engine.go`) calls `tx.ListRoutes()` which returns routes without `PolicyIds` populated.

### 2. Route labels silently dropped on read

Labels are accepted on write and stored correctly in the `labels` TEXT column as JSON. The bug is in `unmarshalLabelsJSON()` (line 2070 of `sqlite.go`): when the stored JSON is `""` (empty string) or `"{}"`, the function returns `nil, nil`. This means routes with no labels get `Labels: nil` instead of an empty `Labels` struct. The `scanRoute()` function at line 1765 calls `unmarshalLabelsJSON(labelsJSON)` and assigns the result to `route.Labels`. When the column value is the default `'{}'`, `unmarshalLabelsJSON` returns `nil` because of the early return on line 2071-2072: `if s == "" || s == "{}" { return nil, nil }`. This also means that when labels with actual values are stored and read back, they work correctly -- the bug is specifically that empty/default labels return nil instead of an empty Labels proto.

**Verified**: The same `unmarshalLabelsJSON` function is used by `scanService()` (line 1811), so services have the same nil-labels behavior.

**Note**: The raft driver stores routes as full protojson blobs, so it does not have this specific bug. Labels round-trip correctly through protojson marshal/unmarshal in the raft driver.

### 3. Route and service deletion leaves orphaned policy_bindings

In the sqlite driver, `DeleteRoute()` (line 385) executes `DELETE FROM routes WHERE id = ?` but does not delete from `policy_bindings`. The schema defines `policy_bindings.policy_id` with `ON DELETE CASCADE` referencing `policies(id)`, but there is no FK from `policy_bindings.target_id` to `routes(id)` -- the `target_id` column is a plain TEXT field because it can reference either routes or services. This means deleting a route or service leaves orphaned rows in `policy_bindings`.

In the raft driver, `DeleteRoute` (line 112 of `tx.go`) calls `t.driver.apply(OpDeleteRoute, deleteData{ID: id})` which removes the route from the bbolt bucket but does not scan and remove matching entries from the `bucketPolicyBindings` bucket.

### 4. ImportConfig does not remap or recreate policy bindings

`ImportConfig()` in `engine.go` (line 303) correctly remaps `service_id` references on routes using `svcIDMap`, but it does not handle `policy_ids` at all. The imported snapshot's routes may have `policy_ids` set, but since `CreateRoute` does not call `AttachPolicy`, those bindings are lost. Additionally, policies get new IDs during import (line 349: `tx.CreatePolicy` generates a new UUID), but there is no `policyIDMap` to remap route `policy_ids` to the new policy IDs.

---

## Root Cause Analysis

| Bug | Layer | Root Cause | File:Line |
|-----|-------|------------|-----------|
| policyIds dropped | `config/engine.go` | `applyRouteOp` and `buildSnapshot` never call `AttachPolicy`/`DetachPolicy`/`ListPoliciesByTarget` | engine.go:458-498, 424-449 |
| Labels nil on read | `store/sqlite/sqlite.go` | `unmarshalLabelsJSON` returns nil for `""` and `"{}"` instead of empty `Labels{}` | sqlite.go:2070-2082 |
| Deletion orphans | `store/sqlite/sqlite.go`, `store/raft/tx.go` | `DeleteRoute`/`DeleteService` do not clean `policy_bindings`/`bucketPolicyBindings` | sqlite.go:385-396, raft/tx.go:112-114 |
| Import policyIds lost | `config/engine.go` | `ImportConfig` has no policyID remapping and no `AttachPolicy` calls | engine.go:336-354 |

---

## Scope: Affected Drivers

- **sqlite** (`packages/daemon/internal/store/sqlite/sqlite.go`) -- full implementation, all bugs apply
- **raft** (`packages/daemon/internal/store/raft/tx.go` and `fsm.go`) -- full implementation, policyIds and deletion orphan bugs apply (labels are fine)
- **postgres** (`packages/daemon/internal/store/postgres/postgres.go`) -- empty stub (package declaration only, 3 lines), out of scope
- **mysql** (`packages/daemon/internal/store/mysql/mysql.go`) -- empty stub (package declaration only, 3 lines), out of scope

---

## Design Decision: UPSERT Semantics

The original spec proposed merge-on-update (partial updates). This is **dropped**. The UPSERT flow will use full-replacement semantics:

- **CREATE** (no ID or ID not found in store): validates all required fields (name, matchers, target). Creates entity.
- **UPDATE** (ID found in store): accepts the full entity and replaces it. The existing `validateRouteOp` validates all fields uniformly for UPSERT. This is correct for full-replacement -- the caller must always send the complete entity.

Proto3 cannot distinguish "field explicitly set to zero value" from "field not sent", so partial updates would require field masks or a separate `UpdateRoute` RPC. That is a separate feature, not a bug fix.

## Design Decision: policyIds Enrichment Location

The policyIds enrichment (calling `ListPoliciesByTarget` and populating `Route.PolicyIds`) will happen in the **engine layer** (`buildSnapshot`), not in individual store driver methods. Rationale:

1. `buildSnapshot` already assembles the full snapshot from routes, services, and policies
2. Putting enrichment there means it works for both sqlite and raft without duplicating code in each driver
3. It avoids modifying the `Tx` interface contract (store drivers return what the DB has; the engine enriches)

## Design Decision: Service policyIds

The `Service` proto message does **not** have a `policy_ids` field (verified: `config.proto` lines 58-67). The `policy_bindings` table supports `target_type = 'service'`, but there is no proto field to populate. Service policyIds are **out of scope** for this spec. The junction table binding for services will work once a `policy_ids` field is added to the Service proto (separate future work).

---

## Fix Approach

### Fix 1: Wire policyIds lifecycle in engine layer

**Write path** -- in `applyRouteOp` after the store create/update call succeeds:

1. Get the route ID from the created/updated route
2. Call `tx.ListPoliciesByTarget(ctx, "route", routeID)` to get current bindings
3. Compute diff against the incoming `route.GetPolicyIds()`
4. Call `tx.AttachPolicy(ctx, policyID, "route", routeID)` for each addition
5. Call `tx.DetachPolicy(ctx, policyID, "route", routeID)` for each removal

**Read path** -- in `buildSnapshot` after listing routes:

1. Collect all route IDs
2. For each route, call `tx.ListPoliciesByTarget(ctx, "route", route.GetId())`
3. Assign the returned IDs to `route.PolicyIds`

**N+1 query concern**: `buildSnapshot` currently does `ListRoutes` + `ListServices` + `ListPolicies` (3 queries). Adding per-route `ListPoliciesByTarget` creates an N+1. Two options:

- **Option A (recommended for v1)**: Accept the N+1. Routes are typically in the low hundreds. `ListPoliciesByTarget` is a simple indexed query on `(target_type, target_id)`. Profile later.
- **Option B (future optimization)**: Add a `ListAllPolicyBindings(ctx) (map[string][]string, error)` method to `Tx` that does a single `SELECT policy_id, target_type, target_id FROM policy_bindings` and returns a map keyed by `targetType:targetID`. This avoids N+1 but adds to the interface. Defer to a follow-up if profiling shows a problem.

### Fix 2: Fix labels round-trip in sqlite driver

In `unmarshalLabelsJSON()` at `sqlite.go:2070`:

- When `s == ""` or `s == "{}"`, return `&riokuv1.Labels{Labels: map[string]string{}}` instead of `nil, nil`
- When `len(m) == 0` after unmarshal, return `&riokuv1.Labels{Labels: map[string]string{}}` instead of `nil, nil`

This ensures routes and services always have a non-nil `Labels` field with an initialized map.

### Fix 3: Deletion cleanup for policy_bindings

**sqlite driver** -- in `DeleteRoute` and `DeleteService`, add a `DELETE FROM policy_bindings WHERE target_type = ? AND target_id = ?` call before or after the main delete.

**raft driver** -- in the FSM `applyDelete` for routes and `applyDeleteService` for services, scan the `bucketPolicyBindings` and remove entries where `TargetType` and `TargetID` match. Alternatively, add new FSM operations `OpCleanupRouteBindings` / `OpCleanupServiceBindings`, but the simpler approach is to inline the cleanup in the existing delete handlers.

### Fix 4: ImportConfig policyId remapping

In `engine.go` `ImportConfig`:

1. Build a `policyIDMap` (old ID -> new ID) during policy creation, same pattern as the existing `svcIDMap`
2. After creating all routes, iterate each route's `PolicyIds` and:
   a. Remap old policy IDs to new IDs using `policyIDMap`
   b. Call `tx.AttachPolicy(ctx, newPolicyID, "route", newRouteID)` for each

The import order is already correct (services first, then routes, then policies) but policies need to be created **before** routes so that `AttachPolicy` can reference valid policy IDs. The current order creates policies last. Change the import order to: services -> policies -> routes.

---

## Files to Modify

### Config engine

- **`packages/daemon/internal/config/engine.go`**
  - `applyRouteOp`: after create/update, sync `PolicyIds` to `policy_bindings` via diff
  - `buildSnapshot`: after `ListRoutes`, enrich each route's `PolicyIds` via `ListPoliciesByTarget`
  - `ImportConfig`: add `policyIDMap`, reorder to services -> policies -> routes, call `AttachPolicy` for each route's remapped policyIds

### Store drivers (sqlite)

- **`packages/daemon/internal/store/sqlite/sqlite.go`**
  - `unmarshalLabelsJSON`: return non-nil empty `Labels` for empty/default JSON
  - `DeleteRoute`: add `DELETE FROM policy_bindings WHERE target_type='route' AND target_id=?`
  - `DeleteService`: add `DELETE FROM policy_bindings WHERE target_type='service' AND target_id=?`

### Store drivers (raft)

- **`packages/daemon/internal/store/raft/fsm.go`**
  - `applyDelete` (for routes): scan and remove matching policy bindings from `bucketPolicyBindings`
  - `applyDeleteService`: scan and remove matching policy bindings from `bucketPolicyBindings`

### Tests

- **`packages/daemon/internal/config/engine_test.go`**
  - policyIds on create: create route with policyIds, read back via GetConfig, expect policyIds present
  - policyIds on update: update route policyIds, read back, expect new set
  - policyIds removal: update route with empty policyIds, read back, expect empty
  - policyIds after delete: delete route, verify no orphaned policy_bindings
  - ImportConfig with policyIds: import snapshot with policies + routes with policyIds, verify bindings survive with remapped IDs

- **`packages/daemon/internal/store/sqlite/sqlite_test.go`**
  - Labels round-trip: insert route with labels, scan, verify map values
  - Labels empty: insert route without labels, scan, verify non-nil empty map
  - Labels on services: same tests for service labels
  - DeleteRoute cleanup: attach policy to route, delete route, verify binding gone
  - DeleteService cleanup: attach policy to service, delete service, verify binding gone

---

## Testing Strategy

All tests use real databases (no mocks), table-driven style, run with `-race`.

| Test | Layer | What it validates |
|------|-------|-------------------|
| `TestPolicyIds_CreateRoute` | engine | policyIds persisted via AttachPolicy on create, returned in snapshot |
| `TestPolicyIds_UpdateRoute` | engine | policyIds updated (additions and removals) on subsequent UPSERT |
| `TestPolicyIds_RemoveAll` | engine | Empty policyIds clears all bindings |
| `TestPolicyIds_DeleteRoute_Cleanup` | engine | Deleting route removes its policy_bindings |
| `TestPolicyIds_DeleteService_Cleanup` | engine | Deleting service removes its policy_bindings |
| `TestImportConfig_PolicyIdRemapping` | engine | Import with policies and routes preserves policyId bindings with new IDs |
| `TestLabels_RoundTrip_NonEmpty` | sqlite store | Write route with labels, read back, values match |
| `TestLabels_RoundTrip_Empty` | sqlite store | Route without labels returns non-nil empty Labels |
| `TestLabels_RoundTrip_Service` | sqlite store | Same for services |
| `TestDeleteRoute_CleanupBindings` | sqlite store | policy_bindings rows removed on route delete |
| `TestDeleteService_CleanupBindings` | sqlite store | policy_bindings rows removed on service delete |

---

## Acceptance Criteria

- [ ] Route created with `policyIds` returns those `policyIds` in `GetConfig` snapshot
- [ ] Route updated to add `policyIds` reflects the additions in snapshot
- [ ] Route updated to remove `policyIds` reflects the removals in snapshot
- [ ] Route deletion removes all associated `policy_bindings` rows (no orphans)
- [ ] Service deletion removes all associated `policy_bindings` rows (no orphans)
- [ ] `ImportConfig` with policies and routes preserves policyId bindings after ID remapping
- [ ] Route created with `labels` returns those `labels` on read (not `null`)
- [ ] Route without `labels` returns non-nil empty `Labels` on read
- [ ] Service without `labels` returns non-nil empty `Labels` on read
- [ ] Fixes apply to sqlite and raft drivers only (postgres/mysql are empty stubs)
- [ ] All existing config engine tests pass without modification
- [ ] All existing store tests pass without modification
- [ ] New tests cover every scenario listed above
- [ ] Tests pass with `-race` flag
