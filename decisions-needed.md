# Plan 11 — Super-Admin: Decision List

## D-01: Admin endpoint Orval codegen gap — RESOLVED

**Status:** Resolved in Plan 11 close-out (Task 7, 2026-05-06).

**Original finding:** All three admin endpoint groups (`/admin/tenants`,
`/admin/users`, `/admin/audit`) were implemented in the daemon but absent
from the OpenAPI snapshot Orval consumes. As a result, no React Query
hooks were generated.

**Task 6 step 1 (codegen):** Authored
`packages/proto/openapi-fragments/admin-super.yaml` covering the full
admin surface (list/create/get/update/delete tenants, list users, list
audit) and re-ran `make openapi` + `pnpm run types:gen`. Generated hooks
now live at `packages/web/src/api/generated/admin/admin.ts`:

| Hook                   | Method | Path                          |
| ---------------------- | ------ | ----------------------------- |
| `useListAdminTenants`  | GET    | `/api/v1/admin/tenants`       |
| `useCreateAdminTenant` | POST   | `/api/v1/admin/tenants`       |
| `useGetAdminTenant`    | GET    | `/api/v1/admin/tenants/{id}`  |
| `useUpdateAdminTenant` | PATCH  | `/api/v1/admin/tenants/{id}`  |
| `useDeleteAdminTenant` | DELETE | `/api/v1/admin/tenants/{id}`  |
| `useListAdminUsers`    | GET    | `/api/v1/admin/users`         |
| `useListAdminAudit`    | GET    | `/api/v1/admin/audit`         |

**Task 7 step 2 (consumption — the closing gap):** All three super-admin
components have been rewritten to consume those hooks directly:

- `tenant-inventory.tsx` — `useListAdminTenants` for the table,
  `useCreateAdminTenant` and `useDeleteAdminTenant` for mutations,
  `useQueryClient.invalidateQueries(getListAdminTenantsQueryKey())` to
  refresh after writes.
- `cross-tenant-users.tsx` — `useListAdminUsers`. The detail drawer
  surfaces the daemon-returned `{id, username, status}` fields; the
  per-user memberships/audit deep view is a follow-up.
- `admin-audit-view.tsx` — `useListAdminAudit`. Rows are normalised
  from either the legacy snake_case mock shape or the daemon's
  proto-JSON camelCase shape (`occurredAt`, `entityType`, …).
  Hash-chain verification activates when entries carry both `hash`
  and `prev_hash`; otherwise the UI surfaces an "unsupported" badge
  and disables the verify button (the daemon notes that hash-chain
  emission lands in a follow-up migration).

The mutator at `src/api/mutator.ts` was extended with a second overload
(orval-style `(url, RequestInit) → {data,status,headers}`) so the
generated client and the legacy `apiClient` shim can share one fetch
path. Coverage:

- Vitest super-admin suite (40 tests across 4 files) passes — uses MSW
  handlers (no mock-store priming).
- Vitest RBAC redirect suite asserts a tenant-admin without
  `admin:cross-tenant-read` is bounced to `/access-denied`.
- Playwright spec `e2e/super-admin/super-admin-flow.spec.ts` walks
  `/admin/tenants`, `/admin/users`, `/admin/audit` end-to-end with
  `page.route(...)` interception, including a real two-link SHA-256
  hash chain that the verify button validates.
- Daemon test `TestAdminTenants_Forbidden_NonSuperAdmin` asserts a
  session without `admin:cross-tenant-read` gets `403
  application/problem+json` from `GET /api/v1/admin/tenants`.

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
a mock-side admin audit entry. The Plan 11 close-out follows this
recommendation: components no longer call `logAdminAuditEntry` from the
client — the daemon writes the audit row when the corresponding
mutation succeeds.

---

## D-03: `renders 3 seeded tenants` test — pre-existing timeout — RESOLVED

**Status:** Resolved (2026-05-06).

**Resolution:** The original mock-store-primed test was retired during
the Task 7 rewrite. The new MSW-backed suite uses `await
screen.findByText(...)` everywhere a list row is asserted, so suite
pressure cannot race the network-layer resolver. The full super-admin
vitest suite (40 tests across 4 files) now runs in ~5 s with no flakes
across repeated invocations.
