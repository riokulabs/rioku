# Plan 11 — Super-Admin: Decision List

## D-01: Admin endpoint Orval codegen gap

**Status:** No decision needed — carry forward as deferred.

**Finding:** All three admin endpoints required by Plan 11 are confirmed present in the daemon:

| Method | Endpoint | File |
|--------|----------|------|
| GET | `/api/v1/admin/tenants` | `tenant_routes.go` |
| POST | `/api/v1/admin/tenants` | `tenant_routes.go` |
| GET `/api/v1/admin/tenants/{id}` | `tenant_routes.go` |
| PATCH | `/api/v1/admin/tenants/{id}` | `tenant_routes.go` |
| DELETE | `/api/v1/admin/tenants/{id}` | `tenant_routes.go` |
| GET | `/api/v1/admin/users` | `stage2_finals_routes.go` |
| GET | `/api/v1/admin/audit` | `stage2_finals_routes.go` (via `audit_routes.go`) |

**Gap:** None of these endpoints are present in `openapi.json` (the captured snapshot Orval
generates TypeScript hooks from). As a result, no Orval React Query hooks exist for:
- `useGetAdminTenants` / `useCreateAdminTenant` / `useDeleteAdminTenant`
- `useGetAdminUsers`
- `useGetAdminAudit`

**Impact for Plan 11:** Stage 2 for these views remains on mock-store until the OpenAPI
snapshot is re-captured to include the admin group. The `VITE_USE_MOCKS=false` flip is
not safe for the super-admin surface until then.

**Action required:** A future task (not Plan 11) must:
1. Add `/api/v1/admin/tenants`, `/api/v1/admin/users`, `/api/v1/admin/audit` to the
   openapi.json snapshot (or regenerate via `protoc-gen-openapi`).
2. Re-run Orval codegen (`pnpm orval`) to produce hooks.
3. Replace the mock-store calls in `features/super-admin/` with the generated hooks,
   guarded by `VITE_USE_MOCKS`.

**Plan 11 scope:** Deliver the mock-backed UI with all UX requirements fulfilled
(filters, drawers, audit emission, seed verification, chain integrity). The mock→real
swap is a stage-2 follow-up task.

---

## D-02: Super-admin permission model for tenant inventory access audit

**Status:** Decision deferred.

**Finding:** The plan requires audit emission when a super-admin accesses the tenant
inventory (`adminAudit` chain entry). The current `logAdminAuditEntry` helper in
`resources/audit.ts` supports this. However, the spec does not define which specific
actions should be emitted for read-only super-admin views (e.g., listing tenants).

**Question:** Should listing tenants (a GET operation) emit an `admin_audit` entry
with tier `read`, or only write/destructive super-admin operations?

**Recommendation:** Emit on create/update/delete only. Read access to tenant inventory
is logged at the HTTP layer (daemon) and does not need a mock-side admin audit entry.

---

## D-03: `renders 3 seeded tenants` test — pre-existing timeout

**Status:** Pre-existing — not caused by Plan 11.

**Finding:** `tenant-inventory.test.tsx > TenantInventory > renders 3 seeded tenants`
times out (5 s) in the full test run. The other 6 tests in the same file pass. This
appears to be a test environment timing issue (Vitest worker startup contention) that
pre-dates this branch. The test itself is correct — it passes when run in isolation.

**Action:** No change required for Plan 11. Tracked here for visibility.
