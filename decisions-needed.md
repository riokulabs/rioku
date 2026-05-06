# Decisions needed — plan-02-identity

## Item 02-001 — Missing OpenAPI/proto coverage for identity entities

- **Status:** RESOLVED 2026-05-06 (this worktree)
- **Resolution:** Hand-written OpenAPI fragments added under `packages/proto/openapi-fragments/` (the same pattern Plan 11 uses for admin-super, etc.) covering users, roles, sessions, impersonation, access-policies, and permissions. `make openapi` merges them into `api.full.json`; `pnpm run types:gen` (orval) emits clients to `packages/web/src/api/generated/{users,roles,sessions,impersonation,access-policies,permissions}/`. Fragments mirror the daemon route registrars verbatim (`user_routes.go`, `rbac_routes.go`, `auth_routes.go` /sessions block, `webhooks_cluster_impersonation_routes.go`, `access_policies_routes.go`). Only the tenant-scoped paths are documented (legacy `/api/v1/users` etc. share the same handlers via the registration loop).
- **Codegen path used:** `make openapi` → `cd packages/web && pnpm run types:gen`. Result: 6 new client directories (180 operations, 131 schemas total in api.full.json after the merge).
- **Follow-up open:** real-API wiring of `features/security/*/api.ts` from mock-store to the new generated hooks remains deferred — tracked as **Item 02-004** below.
- **User decision:** N/A (proto/openapi pipeline change, no architectural decision required).
- **Resolution date / commit:** 2026-05-06, branch `stage2/plan-02-identity`.

### Original entry (kept for history)

- **Filed by:** plan-02-identity (stage2/plan-02-identity), 2026-05-06
- **Category:** missing-endpoint
- **What:** The daemon implements REST routes for users, memberships, sessions, roles, impersonation, access-policies, and a permissions catalog (per `contrib-docs/admin-stage2-endpoint-manifest.md`), but these routes are NOT exposed through the proto/buf pipeline. As a result, `make openapi` does not include them, and Orval generates no clients for them under `packages/web/src/api/generated/`. Only `api-keys` and `rbac-policies` have generated clients.
- **Found in:** `packages/proto/gen/openapi/rioku/v1/api.full.json` (tags: `api-keys`, `rbac-policies`, plus service-prefixed entries — none for users/roles/sessions/impersonation/access-policies/permissions); generator path `packages/web/src/api/generated/`.
- **Why it matters:** Plan 02's core deliverable was to swap mock-store calls for Orval-generated hooks. Without those generated clients, the swap is impossible without either (a) regenerating proto coverage for these routes or (b) hand-writing fetch wrappers that replicate the manifest. (a) is cross-cutting and belongs to Plan 00c follow-up; (b) duplicates the openapi contract and will drift.
- **Recommendation:** Reopen Plan 00c to add proto/openapi coverage for the missing tags (users, memberships, roles, sessions, impersonation, access-policies, permissions catalog). Until that lands, plan-02 ships the UI work that does not depend on real wiring (permissions-catalog page, effective-permissions page, source-badge UX) and defers the api.ts wiring entirely. The 10 retired mock-store/mock-seed stubs (commit `c2c32ddb`) remain valid.
- **Alternatives:** Hand-write minimal fetch wrappers in `src/api/generated/<entity>/<entity>.ts` matching the manifest. Rejected for now — the wrappers will diverge from the OpenAPI contract once proto coverage lands.

## Item 02-002 — Daemon ApiKey shape mismatch with stage-1 mock

- **Status:** open
- **Filed by:** plan-02-identity (stage2/plan-02-identity), 2026-05-06
- **Category:** missing-data
- **What:** The generated `GetAPIKey200` type (from OpenAPI) carries `tenantId`, `createdAt`, `revokedAt` (timestamp), `lastUsedAt`, `scopes`, `usageCount`, `ownerId`. The stage-1 mock `ApiKey` type uses `tenant_id`, `created_at`, `revoked` (bool), `last_used`, `scope`, `prefix`, `user_id`. Notably, **`prefix` is not in the daemon response** — the SPA list/detail views display `key.prefix` to identify keys without exposing the secret.
- **Found in:** `packages/web/src/api/generated/schemas/getAPIKey200.ts` vs `packages/web/src/api/resources/_internal.ts` (ApiKey).
- **Why it matters:** Real-API wiring for api-keys requires either an adapter (manageable) and/or a daemon-side addition of `prefix` to the API key response (preferable — without it, the UI cannot show identifying tokens to humans). `revoked: bool` vs `revokedAt: timestamp` is similarly load-bearing for filter logic.
- **Recommendation:** Add `prefix` to the daemon `ApiKey` response and align field naming via the proto. Once aligned, the SPA adapter shrinks to a thin camelCase→snake_case transform.
- **Alternatives:** Adapter-only — derive a synthetic prefix from `id`. Rejected: prefix must match the actual key value for support/debug.
- **User decision:** [pending]
- **Resolution date / commit:** [pending]

## Item 02-003 — Permission catalog endpoint not exposed

- **Status:** RESOLVED 2026-05-06 (this worktree)
- **Resolution:** The daemon DOES register `GET /api/v1/permissions` (and `GET /api/v1/t/{tenant}/permissions`) — see `RegisterRBACRoutes` in `packages/daemon/internal/gateway/rbac_routes.go` line 41 and `handleListPermissions` line 397. The endpoint was not exposed in the OpenAPI document; this is now closed by the new `packages/proto/openapi-fragments/permissions.yaml` fragment. The fragment includes the `source` field (built-in / plugin-manifest / plugin-dynamic) and the `?source=` query filter that RD6 needs for the catalog page. Generated client lives at `packages/web/src/api/generated/permissions/permissions.ts`.
- **Per-user effective-permissions:** still computed client-side from the catalog × the user's role grants. A dedicated server-side `GET /users/{id}/effective-permissions` is NOT documented in this fragment because no daemon route currently implements it. Tracked as Item 02-005 below if a server-side compute is desired.
- **Resolution date / commit:** 2026-05-06, branch `stage2/plan-02-identity`.

### Original entry (kept for history)

- **Filed by:** plan-02-identity (stage2/plan-02-identity), 2026-05-06
- **Category:** missing-endpoint
- **What:** RD6 (permission source UI badge + filter) and the new `permissions-catalog` page require an endpoint returning the full permission catalog (built-in + plugin-manifest + plugin-dynamic, with `source` field per permission). The daemon has `host/permissions-catalog` infrastructure, but no REST endpoint or proto definition exposes it.
- **Found in:** `packages/web/src/hooks/use-permissions-catalog.ts` (mock-store-backed); `contrib-docs/admin-stage2-endpoint-manifest.md` lists no `GET /api/v1/permissions` row.
- **Why it matters:** The new permissions-catalog page in this plan ships against the mock store; flipping to real data in Plan 13 will fail without the endpoint.
- **Recommendation:** Add `GET /api/v1/permissions` (and tenant-scoped variant for plugin-dynamic permissions registered per-tenant) before Plan 13 close-out.
- **Alternatives:** Embed the catalog into the SPA bundle at build time. Rejected: plugin-dynamic permissions are runtime.

## Item 02-004 — api.ts wiring from mock-store to generated hooks

- **Status:** open (deferred to a follow-up worktree)
- **Filed by:** plan-02-identity (stage2/plan-02-identity), 2026-05-06
- **Category:** scope-deferral
- **What:** With Item 02-001 resolved (codegen now produces generated hooks for users/roles/sessions/impersonation/access-policies/permissions), the next step is to replace mock-store reads/writes inside `packages/web/src/features/security/*/api.ts` with the new generated `useListUsers` / `useCreateRole` / etc. hooks.
- **Why it remains deferred:** A prior agent attempted this end-to-end and produced a 1313-line WIP that depended on Orval clients which did not yet exist; it left 52 type errors and was stashed. Re-doing the wiring is mechanically straightforward NOW that the generated hooks exist, but it touches every consumer component (drawer forms, list pages, mutation handlers) and the field-shape adapters between snake_case mock types (`User`, `Membership`, `Session`, `Role`, `ApiKey`) and the camelCase generated response types. Doing this safely requires either (a) a feature-by-feature migration with running typecheck after each, or (b) introducing an adapter module that converts between the two shapes. Both are larger than what fits in the current loop.
- **Recommendation:** Open a follow-up worktree `stage2/plan-02b-identity-wiring` that does feature-by-feature migration — users → roles → sessions → api-keys → rbac-policies → access-policies → impersonation. Each commit migrates one feature's `api.ts` and any consumers that break. The `VITE_USE_MOCKS` flag should remain `true` in dev until all features are wired so the rest of the panel keeps working.
- **What this worktree shipped instead:** the codegen pipeline closure (proto→openapi→orval), so that follow-up worktree has a real foundation to wire against. The mock-store-backed `api.ts` files remain in place and functional.
- **User decision:** [pending — confirm a 02b worktree is the right next step vs. continuing here.]

## Item 02-005 — Server-side `effective-permissions` for a user

- **Status:** open (low-priority follow-up)
- **Filed by:** plan-02-identity (stage2/plan-02-identity), 2026-05-06
- **Category:** missing-endpoint (low priority)
- **What:** The admin panel computes "effective permissions for user X" client-side by joining the permission catalog with the user's role grants. There is no daemon endpoint that returns the join result directly.
- **Why this can wait:** the client-side compute is correct and cheap (the catalog and grants are small; both are already loaded for adjacent UIs). A server endpoint becomes attractive if/when permission resolution gains conditional logic (deny rules, time-bounded grants, ABAC) that the client can't replay safely.
- **Recommendation:** Defer until conditional resolution lands. If/when added, document under a new `GET /api/v1/t/{tenant}/users/{id}/effective-permissions` and add a fragment.
