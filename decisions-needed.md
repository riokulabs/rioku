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

- **Status:** RESOLVED 2026-05-06 (this worktree, partial — see scope notes)
- **Resolution:** Wired the real-API surface for all seven identity features without breaking the stage-1 mock path. Specifically:
  1. **OpenAPI fragments augmented** — added explicit list-response schemas to `users.yaml`, `roles.yaml`, `api-keys.yaml`, `access-policies.yaml`, and `rbac-policies.yaml`. Previously these advertised only `description: ok`, so Orval was emitting `data: void` for every `useListXxx`. After regen the list types are usable (`ListRoles200 = { roles?: ListRoles200RolesItem[] }` etc.).
  2. **`api/mutator.ts` extended** — now supports both the in-tree `customFetch({url, method, ...})` shape and the Orval-fetch-client `customFetch(url, RequestInit)` shape. Previously the generated client called the mutator with the wrong arity; this was masked by `@ts-nocheck` on every generated file. The Orval form returns `{ data, status, headers }` per Orval's contract.
  3. **`api/mode.ts` added** — single-source-of-truth helper (`isRealApi()` / `useMocks()`) reading `import.meta.env.VITE_USE_MOCKS`.
  4. **Per-feature `realApi.ts` re-exports** added under each `features/security/<entity>/`. These are the entry points consumers + tests use to call the daemon directly. Files: `users/realApi.ts`, `roles/realApi.ts`, `sessions/realApi.ts`, `api-keys/realApi.ts`, `rbac-policies/realApi.ts`, `access-policies/realApi.ts`, `impersonation/realApi.ts`.
  5. **Impersonation banner wired** — `<ImpersonationBanner>` now reads via the new `useImpersonationSession()` bridge hook, which calls `useListImpersonationSessions` from `@/features/security/impersonation/realApi` when real-API mode is enabled and falls back to the mock store otherwise. No banner consumer changes were needed.
  6. **Permission-source UI (RD6)** added to the role grant editor (`features/security/roles/components/detail.tsx`). Each grant row now shows a Mantine `Badge` carrying the catalog source (`built-in` / `plugin-manifest` / `plugin-dynamic`); when a grant references a permission no longer in the catalog the row renders a red `Alert` with `data-testid="grant-orphan-alert"` and an `ORPHANED` label.
  7. **MSW audit-emission test** at `src/features/security/__tests__/audit-emission.test.tsx` (9 tests, all passing) — exercises one mutation per entity through the generated hooks and asserts the daemon sees the right verb + path + body. This is the contract test against future request-shape regressions.
  8. **`src/test/msw-server.ts`** updated to register the new `getUsersMock`/`getRolesMock`/`getSessionsMock`/`getAccessPoliciesMock`/`getImpersonationMock`/`getPermissionsMock` handlers that ship with the regenerated clients.
- **Scope NOT taken in this worktree (intentional):** the mock-store-backed `useUserList` / `useRoleList` / etc. **selectors** inside each `api.ts` were left in place. Replacing them requires resolving the mock↔generated shape gap (snake_case `Role.grants: Grant[]` vs generated `roles[i].permissions: string[]`; `Membership` is not a separate daemon resource at all, only an embedded view; `Session.last_seen` vs generated `lastActivityAt`; `AccessPolicy.condition` vs `expression`; etc.). That migration touches every consumer component (drawer forms, list pages, mutation handlers) and is best done feature-by-feature in a `stage2/plan-02c-selector-migration` worktree. The `realApi.ts` re-exports are the stable target for that migration.
- **Verification gauntlet (this worktree):**
  - `pnpm exec tsc -b tsconfig.node.json && pnpm exec tsc --noEmit` — 0 errors
  - `pnpm exec eslint <touched paths>` — 0 errors (after `--fix`)
  - `pnpm exec vitest run src/features/security src/layout/__tests__/impersonation-banner src/api/mutator` — 121 passed, 0 failed
  - Pre-existing baseline test failures (widgets, dashboards, dashboard-builder, sidebar) confirmed unchanged by stash-and-rerun.
- **User decision:** N/A. Selector migration is mechanical; tracked for a follow-up worktree.
- **Resolution date / commit:** 2026-05-06, branch `stage2/plan-02-identity`.

## Item 02-005 — Server-side `effective-permissions` for a user

- **Status:** open (low-priority follow-up)
- **Filed by:** plan-02-identity (stage2/plan-02-identity), 2026-05-06
- **Category:** missing-endpoint (low priority)
- **What:** The admin panel computes "effective permissions for user X" client-side by joining the permission catalog with the user's role grants. There is no daemon endpoint that returns the join result directly.
- **Why this can wait:** the client-side compute is correct and cheap (the catalog and grants are small; both are already loaded for adjacent UIs). A server endpoint becomes attractive if/when permission resolution gains conditional logic (deny rules, time-bounded grants, ABAC) that the client can't replay safely.
- **Recommendation:** Defer until conditional resolution lands. If/when added, document under a new `GET /api/v1/t/{tenant}/users/{id}/effective-permissions` and add a fragment.
