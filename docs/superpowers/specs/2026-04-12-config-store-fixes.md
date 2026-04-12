# Config Store UPSERT Fixes

**Date**: 2026-04-12
**Scope**: Config engine UPSERT flow — partial updates, policyIds lifecycle, labels round-trip

---

## Problem

Three related bugs in the config UPSERT flow:

### 1. Partial updates fail with 500

Sending `{id, policyIds}` without `name` on an existing route fails validation with:

```
apply change: config: validation: route name is required
```

The engine treats every UPSERT as a full replacement. On UPDATE (existing entity with ID), omitted fields are treated as empty rather than preserved. CREATE path is unaffected.

### 2. policyIds silently dropped on create

`CreateRoute()` and the read-back path (`GetRoute`/`ListRoutes`) never call `AttachPolicy()`/`ListPoliciesByTarget()`. The `policy_bindings` junction table exists in the schema and the `Tx` interface exposes `AttachPolicy()`/`DetachPolicy()`/`ListPoliciesByTarget()`, but the config engine never invokes them. Routes created with `policyIds` return 200 but the junction table is never populated.

### 3. Route labels silently dropped

Labels are accepted on write (200 response) but return `null` on read. The `labels` column exists in the routes table. `scanRoute()` does not correctly unmarshal the JSON column back into the route struct.

**Note**: `healthCheck` on services works correctly (tested and confirmed).

---

## Root Cause Analysis

| Bug | Layer | Root Cause |
|-----|-------|------------|
| Partial update 500 | `config/engine.go` | `applyRouteOp`/`applyServiceOp` pass the incoming entity directly to the store without merging with current state |
| policyIds dropped | `config/engine.go` | No calls to `AttachPolicy`/`DetachPolicy` after route create/update; no calls to `ListPoliciesByTarget` in read path |
| Labels null on read | `store/sqlite/sqlite.go` (and pg/mysql) | `scanRoute()` scans the labels column but does not unmarshal the JSON blob into `map[string]string` |

---

## Fix Approach

### Fix 1: Merge-on-update

In `applyRouteOp` and `applyServiceOp`, when the operation targets an existing entity (has ID and entity exists in store):

1. Fetch the current entity from the store
2. Merge incoming fields onto the current entity — only overwrite fields that are explicitly set in the incoming payload
3. Validate the merged entity
4. Persist the merged entity

Field presence detection: use the proto field mask or check for zero-value fields in the incoming struct. A field set to its zero value (empty string, 0, nil) in the incoming payload is treated as "not provided" unless the full entity is being sent. This matches the existing UPSERT semantics where CREATE sends all fields and UPDATE sends only changed fields.

### Fix 2: Wire policyIds lifecycle

**Write path** (after route create or update in `applyRouteOp`):

1. Call `ListPoliciesByTarget(tx, "route", routeID)` to get current bindings
2. Diff against incoming `policyIds`
3. Call `AttachPolicy(tx, policyID, "route", routeID)` for additions
4. Call `DetachPolicy(tx, policyID, "route", routeID)` for removals

**Read path** (in store drivers):

1. In `GetRoute()` and `ListRoutes()`, after scanning the route row, call `ListPoliciesByTarget(tx, "route", routeID)`
2. Populate `PolicyIds` field on the returned route struct

Same pattern applies to services if they support policy bindings.

### Fix 3: Fix labels round-trip

In `scanRoute()` across all three store drivers:

1. Scan the labels column as `[]byte` (or `sql.NullString`)
2. If non-null, `json.Unmarshal` into `map[string]string`
3. Assign to the route struct's `Labels` field

---

## Files to Modify

### Config engine

- **`packages/daemon/internal/config/engine.go`**
  - `applyRouteOp`: add merge-on-update logic before validation; add policyIds sync after persist
  - `applyServiceOp`: add merge-on-update logic before validation

### Store drivers

- **`packages/daemon/internal/store/sqlite/sqlite.go`**
  - `scanRoute()`: fix labels JSON unmarshaling
  - `GetRoute()`: call `ListPoliciesByTarget` and populate `PolicyIds`
  - `ListRoutes()`: call `ListPoliciesByTarget` per route and populate `PolicyIds`

- **`packages/daemon/internal/store/postgres/postgres.go`**
  - Same changes as sqlite driver

- **`packages/daemon/internal/store/mysql/mysql.go`**
  - Same changes as sqlite driver

### Tests

- **`packages/daemon/internal/config/engine_test.go`**
  - Partial update: send `{id, policyIds}` on existing route, expect 200 with merged fields
  - Partial update: send `{id, name}` on existing route, expect other fields preserved
  - policyIds on create: create route with policyIds, read back, expect policyIds present
  - policyIds on update: update route policyIds, read back, expect new set
  - policyIds removal: update route with empty policyIds, read back, expect empty

- **`packages/daemon/internal/store/sqlite/sqlite_test.go`**
  - `scanRoute` labels round-trip: insert route with labels JSON, scan, verify map
  - `AttachPolicy` + `ListPoliciesByTarget`: attach policies to route, list, verify
  - `DetachPolicy`: attach then detach, verify removed

---

## Testing Strategy

All tests use real databases (no mocks), table-driven style, run with `-race`.

| Test | Layer | What it validates |
|------|-------|-------------------|
| `TestPartialUpdate_Route` | engine | Partial update merges with existing, validation passes |
| `TestPartialUpdate_Service` | engine | Same for services |
| `TestPartialUpdate_NoExisting` | engine | Partial update on non-existent entity creates it (requires all fields) |
| `TestPolicyIds_CreateRoute` | engine | policyIds persisted on create |
| `TestPolicyIds_UpdateRoute` | engine | policyIds updated on subsequent UPSERT |
| `TestPolicyIds_RemoveAll` | engine | Empty policyIds clears bindings |
| `TestLabels_RoundTrip` | store | Write labels, read back, values match |
| `TestLabels_NullHandling` | store | Route without labels returns empty map, not nil |
| `TestAttachPolicy_Store` | store | AttachPolicy creates binding, ListPoliciesByTarget returns it |
| `TestDetachPolicy_Store` | store | DetachPolicy removes binding |

---

## Acceptance Criteria

- [ ] Partial update (send only changed fields + ID) on an existing route succeeds without 500
- [ ] Partial update preserves all fields not included in the payload
- [ ] Route created with `policyIds` returns those `policyIds` on `GET`
- [ ] Route updated to add `policyIds` reflects the additions on `GET`
- [ ] Route updated to remove `policyIds` reflects the removals on `GET`
- [ ] Route created with `labels` returns those `labels` on `GET` (not `null`)
- [ ] Route without `labels` returns empty map `{}` on `GET`
- [ ] All existing config engine tests pass without modification
- [ ] All existing store tests pass without modification
- [ ] New tests cover every scenario listed above
- [ ] Tests pass with `-race` flag
