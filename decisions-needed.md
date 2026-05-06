# Decisions needed — plan-02-identity

## Item 02-001 — Missing OpenAPI/proto coverage for identity entities

- **Status:** open
- **Filed by:** plan-02-identity (stage2/plan-02-identity), 2026-05-06
- **Category:** missing-endpoint
- **What:** The daemon implements REST routes for users, memberships, sessions, roles, impersonation, access-policies, and a permissions catalog (per `contrib-docs/admin-stage2-endpoint-manifest.md`), but these routes are NOT exposed through the proto/buf pipeline. As a result, `make openapi` does not include them, and Orval generates no clients for them under `packages/web/src/api/generated/`. Only `api-keys` and `rbac-policies` have generated clients.
- **Found in:** `packages/proto/gen/openapi/rioku/v1/api.full.json` (tags: `api-keys`, `rbac-policies`, plus service-prefixed entries — none for users/roles/sessions/impersonation/access-policies/permissions); generator path `packages/web/src/api/generated/`.
- **Why it matters:** Plan 02's core deliverable was to swap mock-store calls for Orval-generated hooks. Without those generated clients, the swap is impossible without either (a) regenerating proto coverage for these routes or (b) hand-writing fetch wrappers that replicate the manifest. (a) is cross-cutting and belongs to Plan 00c follow-up; (b) duplicates the openapi contract and will drift.
- **Recommendation:** Reopen Plan 00c to add proto/openapi coverage for the missing tags (users, memberships, roles, sessions, impersonation, access-policies, permissions catalog). Until that lands, plan-02 ships the UI work that does not depend on real wiring (permissions-catalog page, effective-permissions page, source-badge UX) and defers the api.ts wiring entirely. The 10 retired mock-store/mock-seed stubs (commit `c2c32ddb`) remain valid.
- **Alternatives:** Hand-write minimal fetch wrappers in `src/api/generated/<entity>/<entity>.ts` matching the manifest. Rejected for now — the wrappers will diverge from the OpenAPI contract once proto coverage lands.
- **User decision:** [pending]
- **Resolution date / commit:** [pending]

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

- **Status:** open
- **Filed by:** plan-02-identity (stage2/plan-02-identity), 2026-05-06
- **Category:** missing-endpoint
- **What:** RD6 (permission source UI badge + filter) and the new `permissions-catalog` page require an endpoint returning the full permission catalog (built-in + plugin-manifest + plugin-dynamic, with `source` field per permission). The daemon has `host/permissions-catalog` infrastructure, but no REST endpoint or proto definition exposes it.
- **Found in:** `packages/web/src/hooks/use-permissions-catalog.ts` (mock-store-backed); `contrib-docs/admin-stage2-endpoint-manifest.md` lists no `GET /api/v1/permissions` row.
- **Why it matters:** The new permissions-catalog page in this plan ships against the mock store; flipping to real data in Plan 13 will fail without the endpoint.
- **Recommendation:** Add `GET /api/v1/permissions` (and tenant-scoped variant for plugin-dynamic permissions registered per-tenant) before Plan 13 close-out.
- **Alternatives:** Embed the catalog into the SPA bundle at build time. Rejected: plugin-dynamic permissions are runtime.
- **User decision:** [pending]
- **Resolution date / commit:** [pending]
