# Plan 11 — Super-Admin: Decision List

## D-01: Admin endpoint Orval codegen gap — RESOLVED

**Status:** Resolved in Plan 11 close-out (Task 6).

**Original finding:** All three admin endpoint groups (`/admin/tenants`,
`/admin/users`, `/admin/audit`) were implemented in the daemon but absent
from the OpenAPI snapshot Orval consumes. As a result, no React Query
hooks were generated.

**Resolution:** Authored the `packages/proto/openapi-fragments/admin-super.yaml`
fragment covering the full admin surface (list/create/get/update/delete
tenants, list users, list audit) and re-ran `make openapi` followed by
`pnpm run types:gen`. Generated hooks now live at
`packages/web/src/api/generated/admin/admin.ts` and include:

| Hook                   | Method | Path                          |
| ---------------------- | ------ | ----------------------------- |
| `useListAdminTenants`  | GET    | `/api/v1/admin/tenants`       |
| `useCreateAdminTenant` | POST   | `/api/v1/admin/tenants`       |
| `useGetAdminTenant`    | GET    | `/api/v1/admin/tenants/{id}`  |
| `useUpdateAdminTenant` | PATCH  | `/api/v1/admin/tenants/{id}`  |
| `useDeleteAdminTenant` | DELETE | `/api/v1/admin/tenants/{id}`  |
| `useListAdminUsers`    | GET    | `/api/v1/admin/users`         |
| `useListAdminAudit`    | GET    | `/api/v1/admin/audit`         |

**Scope of Plan 11:** Generated hooks are now available but components
remain mock-store backed. The mock→real swap is a uniform, cross-feature
flip (see `contrib-docs/admin-stage2-entry.md`, `src/api/mode.ts`,
`VITE_USE_MOCKS=false`) and is not Plan 11's responsibility — no other
stage-2 feature has flipped yet either. Plan 11 closes the OpenAPI
codegen gap so super-admin is no longer the bottleneck for the flip.

---

## D-02: Super-admin permission model for tenant inventory access audit

**Status:** Decision deferred.

**Finding:** The plan requires audit emission when a super-admin accesses
the tenant inventory (`adminAudit` chain entry). The current
`logAdminAuditEntry` helper in `resources/audit.ts` supports this.
However, the spec does not define which specific actions should be
emitted for read-only super-admin views (e.g., listing tenants).

**Question:** Should listing tenants (a GET operation) emit an
`admin_audit` entry with tier `read`, or only write/destructive
super-admin operations?

**Recommendation:** Emit on create/update/delete only. Read access to
tenant inventory is logged at the HTTP layer (daemon) and does not need
a mock-side admin audit entry.

---

## D-03: `renders 3 seeded tenants` test — pre-existing timeout — RESOLVED

**Status:** No longer applicable.

**Finding:** The originally-flagged test name does not exist in the
current test file. The closest test (`shows all 3 named seeded tenant
slugs in the table`) passes consistently. The full Plan 11 super-admin
suite (36 tests across 3 files) passes in 5.8s with no flakes observed
across multiple runs during Task 6 close-out.
