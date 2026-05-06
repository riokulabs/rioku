# Plan 05 — Audit — Decisions Needed

## 05-001 OpenAPI coverage for audit list / detail / retention / export — RESOLVED

The fragment `packages/proto/openapi-fragments/audit-extra.yaml` now covers the
full audit surface served by the daemon:

- `GET  /api/v1/t/{tenant}/audit` (list, with `actor` / `entity_type` /
  `entity_id` / `range` / `since` / `until` / `limit` / `offset` query
  params and an explicit `AuditEntry` array response schema; total in
  `X-Total-Count` header)
- `GET  /api/v1/t/{tenant}/audit/{id}` (detail, `AuditEntry` schema)
- `POST /api/v1/t/{tenant}/audit/{id}/reveal` (sensitive-fields reveal)
- `GET  /api/v1/t/{tenant}/audit/stream` (SSE)
- `GET  /api/v1/t/{tenant}/audit/export/csv` and `/jsonl` (streaming export
  with explicit filter query params)
- `GET  /api/v1/t/{tenant}/audit/actors` and `/audit/resource-ids` (typeahead
  with explicit `{items, total, …}` response schemas)
- `GET` and `PUT /api/v1/t/{tenant}/audit/retention` (retention config GET +
  upsert, with explicit `AuditRetentionConfig` schema)

Generated Orval clients now expose the matching hooks under
`packages/web/src/api/generated/audit/audit.ts`:
`useListAuditEntries[Infinite]`, `useGetAuditEntry`, `useRevealAuditEntry`
(mutation), `useGetAuditRetentionConfig`, `useUpsertAuditRetentionConfig`
(mutation), plus the existing typeahead/export/stream hooks.

## 05-002 T1 list / filter / infinite scroll — DEFERRED (rationale: minimal value-add)

**Status:** still mock-store backed. The OpenAPI gap is now closed
(`useListAuditEntries[Infinite]` is generated), so the future swap is one
file: replace the body of `useAuditList` / `useAuditListInfinite` in
`features/audit/api.ts` with the generated hook + a server-side filter
translation layer. The translation layer is non-trivial because the SPA
filter shape (multi-handle actor + resource, action / outcome / tier
multi-select, free-text search) is richer than the daemon query (single
actor / entity_type / entity_id / range). A real swap will need either a
client-side post-filter on top of the server query OR a daemon-side filter
extension — neither belongs in this plan.

## 05-003 T2 sensitive reveal — RESOLVED

- Daemon: `POST /api/v1/t/{tenant}/audit/{id}/reveal` added in
  `packages/daemon/internal/gateway/audit_extra_routes.go::handleAuditReveal`,
  guarded by `audit:read-sensitive`. Persists a typed follow-up audit row
  with the new schema `audit.sensitive_revealed.v1` (registered in
  `packages/daemon/internal/store/audit/payloads.go::AuditSensitiveRevealed`).
- Frontend: `detail.tsx::confirmReveal` calls the generated
  `useRevealAuditEntry` mutation; the host event continues to fire on
  settle so mock-store mode keeps recording the bypass locally.
- Daemon test: `TestAuditExtra_Reveal` in
  `audit_extra_routes_test.go` covers the happy path + short-reason 400 +
  follow-up row persistence with the typed payload schema.

## 05-004 T4 CSV / JSONL streaming export — RESOLVED

- Frontend: `streamAuditExport` in `features/audit/api.ts` issues a `fetch`
  to the daemon export endpoint and reads the response via
  `response.body.getReader()`, assembling chunks into a Blob and triggering
  a `<a download>` save. `audit.tsx::handleExport` now tries the streaming
  daemon endpoint first and falls back to the existing in-memory blob
  exporter when the daemon is unreachable (mock-store mode, network error,
  or 4xx).
- Tests: `streamAuditExport` Vitest covers reader streaming + 5xx error
  surfacing in `features/audit/__tests__/api.test.ts`.

## 05-005 T5 retention config — RESOLVED

- Frontend: `retention-config-form.tsx::handleSubmit` now also fires the
  generated `useUpsertAuditRetentionConfig` mutation on submit, alongside
  the existing mock-store `updateRetentionConfig`. Daemon-side errors are
  swallowed so the mock-store happy path remains the source of truth in
  mock mode.
- Daemon endpoints already shipped at `/api/v1/t/{tenant}/audit/retention`
  (GET + PUT) in `packages/daemon/internal/gateway/settings_configs_routes.go`.
- Note: when `VITE_USE_MOCKS=false`, the form will need its
  `useRetentionConfig` selector swapped to `useGetAuditRetentionConfig`.
  That swap is one file and unblocked by this plan.

## 05-006 T7 per-entity filter — SHIPPED (unchanged)

Entity-page deep-links via `?entity_type=service&entity_id=svc-123` (or the
equivalent `resource_type=…&resource_id=…` aliases) are decoded into the
canonical `resource_types` + `resource_id_handles` filter shape inside
`validateSearch` of the audit route. Closes the SPA half of #82.

## 05-007 Final verify gauntlet

- `pnpm exec tsc --noEmit` — clean (0 errors)
- `pnpm exec eslint src/` — 0 errors, 29 pre-existing warnings (none in audit
  feature)
- `pnpm exec vitest run src/features/audit src/routes/t.$tenant/security/audit_.admin.tsx`
  — 74 tests; the `verify chain button shows "Chain verified" badge` test in
  `admin-audit.test.tsx` is a pre-existing WebCrypto load-dependent flake.
  Bumped its timeout from 5s→15s with a 20s hook timeout; passes when run
  alone but still flakes under heavy concurrent vitest pressure. Tracked
  separately.
- `cd packages/daemon && go vet ./internal/gateway/ ./internal/store/audit/`
  — clean
- `go test ./internal/gateway/ -run TestAudit -short -race` — 21 tests pass
  including the new `TestAuditExtra_Reveal` and updated `OPTIONSCoverage`.
