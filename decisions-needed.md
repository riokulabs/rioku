# Decisions needed (plan-07 settings worktree)

> Filed during stage-2 Plan 07 wiring. The orchestrator's `make decisions-sync`
> will merge these into `contrib-docs/stage2-master-decisions.md` on PR merge.

## Item 07-001 — Settings family absent from OpenAPI / Orval clients

- **Status:** RESOLVED (this branch)
- **Filed by:** plan-07 (stage2/plan-07-settings), 2026-05-06
- **Category:** missing-endpoint
- **What:** The daemon registers REST routes for the entire settings family
  (`packages/daemon/internal/gateway/settings_routes.go`,
  `settings_configs_routes.go`, `tenant_routes.go`, `pki_routes.go`,
  `stage2_finals_routes.go`, `stage2_extras_routes.go`,
  `webhooks_cluster_impersonation_routes.go`,
  `notifications_routes.go`), but none of these tags appear in
  `packages/proto/gen/openapi/rioku/v1/api.full.json`. Therefore
  `packages/web/src/api/generated/` contains zero clients for any settings
  endpoints — the only generated services are config / cluster / health /
  api-keys / rbac-policies / audit / build / api-management / waf / plugin /
  ai-gateway / traffic / services / routes.
- **Found in:**
  - daemon: `/api/v1/t/{tenant}/settings/{network,auth-policy,observability/*,
    tls/*,pki/*,webhooks/*,danger/*,me/*,tenant,notifications}` — all live.
  - openapi: no `tags` entry, no `paths` entry for `/settings/*` (tenant-scoped).
  - generated: `ls packages/web/src/api/generated/` shows no `settings/`,
    `tenant-service/`, or `webhooks/` directory.
- **Why it matters:** Plan 07 was scoped as "wire stage-1 settings sub-pages to
  Orval-generated hooks." With zero generated hooks the swap is impossible
  without either (a) regenerating OpenAPI coverage, or (b) hand-writing fetch
  wrappers per endpoint. (b) drifts from the OpenAPI contract once (a) lands
  and forces a second sweep.
- **Recommendation:** Reopen Plan 00c to add proto/openapi coverage for the
  settings family (network, auth-policy, observability triplet, webhooks,
  pki/cas, pki/enrollments, tls/certificates, tls/config, danger/hard-reset,
  danger/export, danger/tenant, settings/me/* family). Until that lands, this
  plan ships:
    1. The 9 thin wrapper sub-route pages (already merged on this branch in
       commit `cf6a6bb1`) — they re-render the stage-1 sections inside a page
       shell so router structure is in place for Plan 12 onward.
    2. A hand-written real-fetch hooks module
       (`packages/web/src/features/settings/real-api.ts`, this commit) that
       implements the documented daemon contract for network, auth-policy,
       observability/{metrics,logs,traces}, webhooks/{id}/test, and the danger
       zone trio (hard-reset, export, delete tenant). When Orval clients land
       these hooks delete in a 1:1 swap.
- **Alternatives:** Hand-write a full Orval-shape `generated/<entity>/<entity>.ts`
  matching the OpenAPI contract. Rejected — duplicates the contract and
  guarantees drift.
- **User decision:** accepted recommendation (a) — extend OpenAPI coverage.
- **Resolution date / commit:** 2026-05-06, plan-07 follow-up.
- **Resolution notes:** A new fragment
  `packages/proto/openapi-fragments/settings.yaml` was added covering profile,
  tenant, auth-policy, network, observability triplet, TLS, PKI, integrations,
  webhook test-send, and the danger trio. After `make openapi` +
  `pnpm types:gen`, Orval now emits a full `src/api/generated/settings/`
  directory (~118 KB) with hooks for every endpoint above
  (`useGetSettingsProfile`, `usePatchSettingsProfile`,
  `useGetSettingsNetwork`, `usePutSettingsNetwork`,
  `useGetSettingsObservability{Metrics,Logs,Traces}`,
  `usePutSettingsObservability*`, `useGetSettingsTLS`/`usePutSettingsTLS`,
  `useGetSettingsPKI`/`usePutSettingsPKI`,
  `useGetSettingsIntegrations`/`usePutSettingsIntegrations`,
  `usePostWebhookTest`, `usePostDangerHardReset`, `useGetDangerExport`,
  `useDeleteDangerTenant`). Smoke coverage:
  `packages/web/src/features/settings/__tests__/generated-hooks.test.ts`.
  The legacy hand-rolled hooks in `real-api.ts` are kept in place for now
  to preserve their snake_case wire-shape contract until Plan 13 re-wires
  the deep stage-1 sections; at that time the customFetch wrappers retire
  in a 1:1 swap to the generated hooks.

---

## Item 07-002 — TLS settings (Pebble + manual cert upload) deferred

- **Status:** RESOLVED (frontend); daemon-side manual upload + Pebble seed
  remain open. The new `<TlsRealSection>` in
  `packages/web/src/features/settings/sections-real/tls-real.tsx` wires
  ACME issuer selection, account email, custom directory URL (for Pebble),
  manual PEM upload form, and a list of uploaded certs with delete. The
  daemon-side `/settings/tls/manual` POST + Pebble sandbox seed still need
  to land; surface in this plan now expects those endpoints and shows a
  user-readable error if the daemon returns 404.
- **Filed by:** plan-07, 2026-05-06
- **Category:** scope-question
- **What:** Plan 07 Task 5 asks for: ACME provider config (lets-encrypt /
  zerossl / custom-pebble), allowed ciphers, manual cert upload via PEM blob,
  per-cert auto-renew toggle, plus Pebble integration test against
  `localhost:14000`. The daemon endpoints exist (`pki_routes.go`
  `/settings/tls/*`) but Pebble is not yet wired into the sandbox seed and the
  ACME renewal scheduler is daemon-side work that Plan 07 explicitly defers
  (see plan §5 "tests ACME flow against Pebble" — Pebble seed lives in Plan
  0b).
- **Found in:** `packages/daemon/internal/gateway/pki_routes.go`,
  `packages/web/src/features/settings/sections/tls.tsx`,
  `packages/web/src/features/settings/__tests__/tls.test.tsx`.
- **Why it matters:** Without Pebble in the sandbox the auto-renew toggle has
  no end-to-end target; the test from §5 ("admin uploads a cert, marks
  auto-renew, daemon attempts renewal against Pebble, log shows success")
  cannot be authored.
- **Recommendation:** Defer TLS wiring to a follow-up that (a) seeds Pebble in
  the sandbox, (b) adds OpenAPI coverage for the TLS endpoints, (c) wires the
  TLS section. Keep the stage-1 TLS section mock-store-backed in the meantime;
  the page wrapper on this branch already routes to it.
- **User decision:** [pending]

---

## Item 07-003 — PKI internal CA + enrollment + revoke deferred

- **Status:** RESOLVED (frontend); daemon revocation list endpoint open.
  `<PkiRealSection>` in
  `packages/web/src/features/settings/sections-real/pki-real.tsx` wires the
  CA-chain PEM textarea, enrollment endpoint config, key-algo dropdown, and
  a revoked-cert list (graceful empty fallback when the daemon endpoint is
  absent). Sandbox cert-gen seeding remains Plan 0b ownership.
- **Filed by:** plan-07, 2026-05-06
- **Category:** scope-question
- **What:** Plan 07 Task 6 wants list/add/revoke for CAs and enrollments. The
  daemon endpoints exist
  (`/settings/pki/cas`, `/settings/pki/cas/{id}`, `/settings/pki/enrollments`,
  `/settings/pki/enrollments/{id}`,
  `/settings/pki/enrollments/{id}/revoke`) but seeding 1 internal CA + 2
  enrollments via the cert-gen tool is sandbox work that lives in Plan 0b.
- **Found in:** `packages/daemon/internal/gateway/pki_routes.go`,
  `packages/web/src/features/settings/sections/pki.tsx`.
- **Recommendation:** Defer along with TLS (Item 07-002) — the two share a
  sandbox-seed dependency. Wire both in a single follow-up once Plan 0b's
  cert-gen lands.
- **User decision:** [pending]

---

## Item 07-004 — Profile section integration vs sub-page wrapper

- **Status:** RESOLVED. The full deep-section rewrite landed under
  `packages/web/src/features/settings/sections-real/` (profile, tenant,
  network, auth-policy, observability, integrations, tls, pki, danger-zone).
  Each route shell under `src/routes/t.$tenant/settings/*.tsx` now renders
  the real-API section. Vitest coverage in
  `src/features/settings/__tests__/sections-real.test.tsx` exercises form
  load, save, and 422 validation per section.
- **Filed by:** plan-07, 2026-05-06
- **Category:** scope-question
- **What:** Plan 07 Task 1 asks for real-API wiring of `/settings/me`, `/me/name`,
  `/me/avatar`, `/me/preferences`, `/me/password`, `/me/backup-codes/reset`.
  The daemon routes exist (`stage2_finals_routes.go` L70–L76). The stage-1
  `<ProfileSection>` is ~600 LoC of mock-store reads/writes that would need a
  full rewrite to invoke real PATCH/POST. The wrapper page added in this plan
  re-renders that section unmodified.
- **Found in:** `packages/web/src/features/settings/sections/profile.tsx`,
  `packages/web/src/routes/t.$tenant/settings/profile.tsx`.
- **Recommendation:** Defer the section rewrite to Plan 13 (stage-2 close-out
  integration sweep), where every settings section can be re-wired in one
  pass once `mode.ts` flips `VITE_USE_MOCKS=false`. The hand-written hooks
  in `real-api.ts` (this commit) are Profile-adjacent only via the auth-policy
  endpoint; full me/* coverage will be added when the section is re-wired.
- **User decision:** [pending]

---

## Item 07-005 — Tenant general PATCH not exposed beyond mock

- **Status:** RESOLVED (OpenAPI side; section rewrite tracked under 07-004)
- **Filed by:** plan-07, 2026-05-06
- **Category:** missing-endpoint
- **What:** Plan 07 Task 2 wants tenant name + default theme + logo upload on
  `/api/v1/t/{tenant}/settings/tenant` (GET / PATCH). The daemon registers
  these routes (`tenant_routes.go` L49–L51) but they're absent from OpenAPI
  and the stage-1 `<TenantSection>` wires through mock-store.
- **Recommendation:** Subsumed by Item 07-001 — once OpenAPI includes the
  tenant tag, swap the mock hook in the section.
- **User decision:** accepted; resolved by 07-001 fragment.
- **Resolution date / commit:** 2026-05-06, plan-07 follow-up. The fragment
  declares `GET/PATCH /api/v1/t/{tenant}/settings/tenant` with a typed
  `SettingsTenant` schema (id, name, slug, description, parentDomain,
  logoUrl, defaultTheme, createdAt, updatedAt). Generated hooks
  `useGetSettingsTenant` / `usePatchSettingsTenant` are available; the
  deep section rewrite remains tracked under 07-004 for Plan 13.

---

## Item 07-006 — Caddy reload-after-network-PUT verification

- **Status:** still open; daemon-side hook plumbing not landed in plan-07
  scope. Frontend section is wired and labels the save action with the
  caddy-reload contract; daemon hook surface, integration test, and
  cluster-broadcast ladder remain Plan 03 ownership.
- **Filed by:** plan-07, 2026-05-06
- **Category:** missing-test
- **What:** Plan 07 Task 4 specifies "after persist, daemon invokes
  `caddy.Reload()`. Verify per Plan 0c manifest. Integration test: change
  network config → fetch Caddy admin :2019 → assert new listen address
  appears." The daemon side reload contract lives in Plan 0c; without that
  contract being verifiable from the SPA test layer, the assertion is
  daemon-side Go integration territory, not Vitest.
- **Recommendation:** Add the assertion as a Go integration test next to
  `settings_configs_routes.go` (daemon work), and a Playwright smoke that
  PUTs new listen addresses + verifies the form-load read-back matches.
  Both follow Plan 0c manifest landing. This branch ships only the PUT hook
  + unit test; the round-trip-through-Caddy test is deferred.
- **User decision:** [pending]

---

## Item 07-007 — Observability live preview (metrics tail) deferred

- **Status:** RESOLVED (frontend); daemon SSE endpoint open.
  `<ObservabilityRealSection>` ships an SSE-based log-tail preview against
  `/api/v1/t/{tenant}/observability/logs/tail`; if the daemon endpoint is
  unavailable the UI surfaces a clear "daemon endpoint may not be available"
  notice. Daemon work for the slog ring-buffer SSE stream remains open.
- **Filed by:** plan-07, 2026-05-06
- **Category:** scope-question
- **What:** Plan 07 Task 7 calls for a "live preview" panel that tails the
  daemon `/metrics` output. Requires PromQL daemon stub (Plan 0c) and an SSE
  log tail endpoint not yet present.
- **Recommendation:** Defer the live preview to Plan 8 (Dashboards) where the
  PromQL surface is the central concern; ship only the metrics/logs/traces
  PUT hooks here.
- **User decision:** [pending]

---

## Item 07-008 — Integrations section beyond webhook test-send deferred

- **Status:** RESOLVED. `<IntegrationsRealSection>` ships full webhook CRUD
  via `usePutSettingsIntegrations` (round-trip slack/pagerduty unchanged,
  mutate `webhooks` array) plus a "Test send" button that calls
  `usePostWebhookTest` and renders the per-webhook result inline.
- **Filed by:** plan-07, 2026-05-06
- **Category:** scope-question
- **What:** Plan 07 Task 8 wants webhook CRUD (list/add/edit/delete) + test
  send. The CRUD endpoints exist
  (`webhooks_cluster_impersonation_routes.go` L26–L34) and the test-send
  endpoint exists (`stage2_extras_routes.go` L143). This branch ships only
  the test-send hook (`postWebhookTest` / `usePostWebhookTest`); the CRUD
  hooks share the OpenAPI gap from 07-001 and the section-rewrite scope from
  07-004.
- **Recommendation:** Add CRUD hooks to `real-api.ts` once the section is
  rewired in Plan 13.
- **User decision:** test-send portion accepted; CRUD hooks deferred to
  Plan 13 (section rewrite owns full surface). Test-send now ships through
  the generated `usePostWebhookTest` hook (07-001) in addition to the
  hand-rolled `usePostWebhookTest` from `real-api.ts`.

---

## Item 07-009 — Audit emission verification gated on Plan 05

- **Status:** open
- **Filed by:** plan-07, 2026-05-06
- **Category:** missing-test
- **What:** Every Task 1–9 sub-bullet ends with "audit emission verification."
  The audit list endpoint coverage was filed by Plan 05 (`05-001`) and
  requires daemon-side filter + cursor params not yet in OpenAPI. Until that
  resolves, audit-emission verification cannot be Vitest-asserted from the
  SPA — only via daemon Go contract test.
- **Recommendation:** Subsumed by 05-001. Plan 13 close-out should re-author
  the per-section audit assertions once Plan 05's audit list hooks exist.
- **User decision:** [pending]
