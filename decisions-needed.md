# Plan 05 — Audit — Decisions Needed

## 05-001 Missing OpenAPI coverage for audit list / detail / retention / export

**Audit of `packages/web/src/api/generated/audit/audit.ts` (2026-05-06):** the only
hooks Orval emitted from the OpenAPI spec are:

- `useStreamAuditEntries` / `streamAuditEntries` (no parameters — no filter, no cursor)
- `useListAuditActors` / `useListAuditActorsInfinite` (typeahead candidates)
- `useListAuditResourceIDs` / `useListAuditResourceIDsInfinite` (typeahead candidates)
- `useExportAuditCSV` / `useExportAuditJSONL` (parameter-less query hooks — no filter
  pass-through, returning `unknown` body rather than a streamed `Response`)

**Missing entirely from the spec:**

- `GET /api/v1/t/:tenant/audit/entries` with filter + cursor params (T1 list)
- `GET /api/v1/t/:tenant/audit/entries/:id` (T2 detail)
- `POST /api/v1/t/:tenant/audit/entries/:id/reveal` (T2 reveal flow)
- `GET /api/v1/t/:tenant/audit/retention` (T5 read)
- `PUT /api/v1/t/:tenant/audit/retention` (T5 write)
- A streamed (`Content-Disposition: attachment`) variant of the CSV/JSONL exports
  that lets the SPA render progress via `response.body.getReader()` (T4)

Per the deferral pattern adopted for plans 02/04: this plan applies the
**minimum-viable scope cut** for these tasks. Stage-1 mock-store paths remain in
place behind the existing `features/audit/api.ts` hooks, which already encapsulate
the call sites the future Orval swap will hit.

## 05-002 T1 list / filter / infinite scroll — DEFERRED

**Status:** Wiring deferred. `features/audit/api.ts` retains its mock-store
selector path (`useAuditList` / `useAuditListInfinite`). All call sites already
go through these hooks, so the future swap is one file.

**Smoke:** existing Vitest in `src/features/audit/__tests__/api.test.ts` covers
filter-matcher behaviour, cursor pagination, and search redaction.

**Action:** Add `/api/v1/t/:tenant/audit/entries` (with cursor + filter params)
to the OpenAPI spec, regen Orval, replace the bodies of `useAuditList` /
`useAuditListInfinite` with `useListAuditEntriesInfinite`, re-open T1.

## 05-003 T2 sensitive reveal — daemon endpoint missing, UX flow shipped

**Status:** Reveal UX shipped (modal + reason + host event). The host event
`audit:sensitive-revealed` is emitted on confirm. At stage-2-real time this
will be replaced with a `POST /audit/entries/:id/reveal` round-trip whose
daemon side persists the follow-up audit row.

**Action:** Add `POST /api/v1/t/:tenant/audit/entries/:id/reveal { reason }` to
the OpenAPI spec, swap `emitHostEvent('audit:sensitive-revealed', …)` in
`detail.tsx` for the generated `useRevealAuditEntry` mutation, surface the
returned new audit row to the in-page list.

## 05-004 T4 CSV / JSONL streaming export — DEFERRED

**Status:** Wiring deferred. `exportAuditCsv` / `exportAuditJsonl` in
`features/audit/api.ts` build the blob client-side from the mock store and
trigger a download via `URL.createObjectURL`. This matches the stage-1 contract
and keeps the export menu functional for E2E tests.

**Action:** Add a streamed `GET /api/v1/t/:tenant/audit/export/csv?<filters>`
(Content-Disposition: attachment) and matching JSONL endpoint to the OpenAPI
spec. Replace the in-memory blob construction with a `fetch` + `Response.body`
reader once the daemon endpoint exists.

## 05-005 T5 retention config — DEFERRED

**Status:** Wiring deferred. `useRetentionConfig` / `updateRetentionConfig`
remain mock-store backed. The form (`retention-config-form.tsx`) already
performs the right validation and call shape, so the future swap is again one
file.

**Action:** Add `GET` + `PUT /api/v1/t/:tenant/audit/retention` to the OpenAPI
spec, regen Orval, swap the two hooks in `features/audit/api.ts`.

## 05-006 T7 per-entity filter — SHIPPED

**Status:** Entity-page deep-links via `?entity_type=service&entity_id=svc-123`
(or the equivalent `resource_type=…&resource_id=…` aliases) are now decoded
into the canonical `resource_types` + `resource_id_handles` filter shape inside
`validateSearch` of the audit route. Existing filter machinery picks them up
unchanged. Closes the SPA half of #82.

**Action:** Each entity-feature plan still owns the `<Link>` from its drawer /
full-page to `/t/$tenant/security/audit?entity_type=…&entity_id=…`. Plans 02
(services), 03 (api-mgmt), etc. add their own links.

## 05-007 Final verify gauntlet

`cd packages/web && /usr/bin/env -u RTK_PROXY_OVERRIDE pnpm exec tsc --noEmit` — see commit body.
`/usr/bin/env -u RTK_PROXY_OVERRIDE pnpm exec eslint src/` — see commit body.
`pnpm exec vitest run src/features/audit src/routes/t.$tenant/security/audit_.admin.tsx` — see commit body.
