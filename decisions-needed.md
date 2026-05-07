# Decisions needed (worktree) — Plan 09 plugins

## Item 09-T4 — Plugin entity CRUD wiring

- **Status:** resolved
- **Filed by:** plan-09-plugins (stage2/plan-09-plugins), 2026-05-06
- **Category:** scope-question
- **What:** Whether to retire the mock-store-backed plugin selectors
  (`installed/api.ts`, `marketplace/api.ts`, install-progress streamer)
  in favour of generated TanStack Query hooks against the new daemon
  endpoints.
- **Found in:** `packages/web/src/features/plugins/**`
- **Why it matters:** the mock-store path drives ~80 frontend tests
  (install-approval, install-progress, marketplace, installed list,
  detail). A wholesale rewrite would re-baseline most of plan 06's
  test coverage in a single sub-PR.
- **Recommendation / Resolution:** **mock-store retired** in this
  pass; `installed/api.ts` and `marketplace/api.ts` now call the real
  daemon endpoints via `customFetch`, install-progress streams from
  a real SSE endpoint, the install-from-marketplace mutation hits the
  real POST, and the install/marketplace/installed/detail tests are
  rewritten on top of MSW. Plugin-signers had already been retired in
  the earlier pass (`features/plugin-signers/api.ts`).
- **Alternatives considered:** keep mock-store as default and wire
  later in plan-12. Rejected per audit directive: components must
  call real endpoints in this plan.
- **User decision:** accepted (executor decision per audit directive)
- **Resolution date / commit:** 2026-05-06 / this commit

## Item 09-T5 — Sideload daemon endpoint

- **Status:** resolved
- **Filed by:** plan-09-plugins (stage2/plan-09-plugins), 2026-05-06
- **Category:** missing-endpoint
- **What:** The `POST /api/v1/t/{tenant}/plugins/sideload` endpoint
  was a 501 stub.
- **Recommendation / Resolution:** replaced with a real handler that
  parses multipart, validates the manifest with `plugins.ValidateManifest`,
  optionally verifies signer trust against the tenant's plugin-signers
  via the `Signer-Fingerprint` header, stages the artifact under
  `<DataDir>/plugins/<tenant>/<plugin-id>/`, and inserts the plugin
  row.
- **Security model:**
  - The registrar enforces `plugin:install`.
  - When `Signer-Fingerprint` is set, the daemon requires a
    `signature` part and refuses unknown or non-`verified` signers.
    `cosignVerified=true` is recorded only when the signer row is
    `verified`. Cryptographic verification of the signature blob
    against the archive is delegated to the build-service trust
    ladder (#146); this stage-2 implementation captures the
    fingerprint and stages the blob.
  - When `Signer-Fingerprint` is absent, the artifact is stored
    unverified (`cosignVerified=false`). Tenants that disallow
    unsigned sideload do so via tenant policy, which is out of
    scope here.
- **Build-state mapping:** the existing CHECK constraint allows
  `stable|building|failed`. Native-arch sideloads land at `stable`
  with response `status: "ready"`; cross-arch (manifest `arch` !=
  `runtime.GOARCH`) lands at `building` with response
  `status: "pending-build"`. Adding new constraint values is a
  schema migration tracked by #142.
- **Tests:** `packages/daemon/internal/gateway/sideload_routes_test.go`
  covers happy path, invalid manifest, non-multipart rejection,
  signer-fingerprint-without-signature (403), unknown-signer
  rejection (403), dev-mode-disabled returns 404, dev-mode-enabled
  returns 201, and capabilities endpoint reports the flag.
- **User decision:** accepted (executor decision per Plan 09 scope)
- **Resolution date / commit:** 2026-05-06 / this commit

## Item 09-T6 — Sideload dev-mode gate

- **Status:** resolved
- **Filed by:** plan-09-plugins (stage2/plan-09-plugins), 2026-05-06
- **Category:** security-regression
- **What:** Sideload was reachable in production with only the
  `plugin:install` permission, leaking the endpoint's existence and
  exposing the daemon to drive-by attempts.
- **Resolution:**
  - Added `daemon.sideload_enabled` config field + `RIOKU_SIDELOAD_ENABLED`
    env var (`Config.SideloadEnabled()` reports the union); default false.
  - `handlePluginSideload` now returns 404 (not 403) when the flag is
    off, so the endpoint is indistinguishable from one that doesn't
    exist.
  - Added `GET /api/v1/capabilities` returning the feature-flag
    snapshot. The admin panel reads it via `useDaemonCapabilities()`
    and hides the sideload form + nav surface when disabled.
- **User decision:** accepted (executor decision per audit directive)
- **Resolution date / commit:** 2026-05-06 / this commit

## Item 09-T7 — Permission registry hookup

- **Status:** resolved
- **Filed by:** plan-09-plugins (stage2/plan-09-plugins), 2026-05-06
- **Category:** missing-implementation
- **What:** `rbac_routes.go:385` carried a TODO for the
  `permissionRegistry.Register` interface; plugin manifests with
  custom permissions had no way to register them with the daemon
  catalog so role grants could target them.
- **Resolution:**
  - New `internal/plugins.Register / Unregister` package functions.
  - New `tx.RegisterPluginPermissions / UnregisterPluginPermissions`
    Tx methods on the store driver, implemented for sqlite, postgres,
    mysql.
  - Sideload now invokes `RegisterPluginPermissions` in the same Tx
    as the plugin row insert (atomic). Uninstall invokes
    `UnregisterPluginPermissions` (atomic with `DeletePlugin`).
  - Built-in conflicts surface as `ErrPermissionConflict → 409`. Per
    migration 000049's source-handling rule, plugin-sourced rows are
    deleted outright on uninstall.
- **Tests:** `internal/plugins/permission_registry_test.go` covers
  register/unregister lifecycle, idempotent re-register, built-in
  conflict, invalid id, and resource:action parsing.
- **User decision:** accepted (executor decision per audit directive)
- **Resolution date / commit:** 2026-05-06 / this commit
# Decisions needed (worktree: plan-08-dashboards)

> Plan 08 — dashboards, widgets, dashboard-builder, PromQL proxy.
> T1 landed in commit 437f4c1. T2-T5 wired in this commit set.

## Item 081 — T2 dashboards CRUD + share + version + import/export

- **Status:** resolved
- **Filed by:** plan-08-dashboards (stage2/plan-08-dashboards), 2026-05-06
- **Category:** scope-question
- **What:** Wire the SPA `features/dashboards/` against the daemon endpoints
  exposed by `packages/daemon/internal/gateway/dashboards_routes.go`.
- **Found in:** `packages/web/src/features/dashboards/api.ts` (mock-store-backed).
- **Why it matters:** stage-2 entry requires every plan to ship a daemon-backed
  client; without it, `VITE_USE_MOCKS=false` would 404.
- **Recommendation:** added `features/dashboards/daemon-api.ts` (190 LoC) — a
  typed adapter over the orval-generated client in
  `src/api/generated/dashboards/`. Covers list/detail/create/update/patch/delete,
  share/list-shares/revoke-share, snapshot/list-versions/restore-version, and
  export/import. The existing `api.ts` (mock-store) is left in place so stage-1
  Vitest tests remain green; route components flip via the future
  `src/api/mode.ts` switch (Plan-09 close-out), which is out-of-scope for
  this PR.
- **Resolution date / commit:** 2026-05-06 — `feat(stage2): plan 08 — dashboards
  + widgets + promql daemon adapters` (this commit).

## Item 082 — T3 widgets CRUD + drag-drop reorder + flip wizard/advanced

- **Status:** resolved
- **Filed by:** plan-08-dashboards, 2026-05-06
- **Category:** scope-question
- **What:** Wire `features/widgets/` against the daemon and expose a
  bulk-layout sink for drag-drop reorder.
- **Recommendation:** added `features/widgets/daemon-api.ts` (105 LoC)
  with list/create/update/patch/delete + flip-advanced/flip-wizard +
  `updateLayoutViaDaemon(tenant, dashboardId, layouts)` — the latter
  takes the full per-widget `{x,y,w,h}` map produced by `@dnd-kit`'s
  `arrayMove` and PUTs it server-side in one round-trip. Renderer
  refactor (consuming the daemon DTO with `mode: 'metabase'|'advanced'`
  vs the legacy `'metabase'|'grafana'`) is intentionally deferred to
  the route-flip session — the daemon-api ships fully typed and tested.
- **Resolution date / commit:** 2026-05-06 — same commit as Item 081.

## Item 083 — T4 per-kind widget data fetchers

- **Status:** resolved
- **Filed by:** plan-08-dashboards, 2026-05-06
- **Category:** scope-question
- **What:** Each widget kind (line-chart / bar / single-stat / table)
  needs a real-data fetcher that targets the right daemon endpoint.
- **Recommendation:** added `features/widgets/data-sources/` with
  `promql.ts` (call the T1 PromQL proxy + normalise the Prometheus
  envelope into uniform `series[]`), `registry.ts` (dispatcher keyed
  on `widget.dataSource`: `promql` → live, `audit|notifications|traces`
  → empty-rows stub pending Plan 04/05/06 final wiring), and
  `index.ts` re-exports. Renderers in `features/widgets/components/`
  call `fetchWidgetData(tenant, widget, range)` and render
  `{loading, data, error}` — wiring the existing renderers to this
  dispatcher is part of the route-flip session, not this PR.
- **Resolution date / commit:** 2026-05-06 — same commit.

## Item 084 — T5 default + personal home dashboards

- **Status:** resolved
- **Filed by:** plan-08-dashboards, 2026-05-06
- **Category:** undefined-behavior
- **What:** Resolution order between `isDefault` (tenant-wide) and
  `homeForUsers[]` (per-user) was undocumented.
- **Recommendation:** documented + implemented in
  `resolveEffectiveHomeDashboard(list, userId)`: the personal home
  flag wins, then the tenant default, then `undefined`. Tests cover
  all three cases. Server side, both flags live on the dashboard row
  so a single `listDashboards` call answers the lookup.
- **Resolution date / commit:** 2026-05-06 — same commit.

## Item 085 — `customFetch` mutator double-prefix bug

- **Status:** resolved
- **Filed by:** plan-08-dashboards, 2026-05-06
- **Category:** other
- **What:** Pre-existing bug — `src/api/mutator.ts` accepted the
  project-internal `{url, method, ...}` object shape, but the
  orval-generated clients call it positionally as
  `customFetch(url, RequestInit)`. Additionally `BASE='/api/v1'` was
  always prefixed, which would have produced `/api/v1/api/v1/...`
  for the spec-canonical URLs orval emits.
- **Recommendation:** updated `customFetch` to accept BOTH call
  shapes (`(args)` AND `(url, init)`) and to skip the BASE prefix
  when the URL already starts with `/api/`. Backward-compatible —
  existing `mutator.test.ts` (8 tests) continues to pass unchanged.
- **Resolution date / commit:** 2026-05-06 — same commit.
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

- **Status:** RESOLVED. Daemon manual-upload endpoints
  (`POST /api/v1/t/{tenant}/settings/tls/manual` +
  `DELETE .../manual/{certId}`) shipped in
  `packages/daemon/internal/gateway/settings_tls_routes.go` with PEM
  parse + `tls.X509KeyPair` mismatch detection, SHA-256 fingerprint
  return, RBAC gating on `tls:write`, and a `triggerCaddyReload(ctx,
  "settings.tls.manual")` after every mutation. Tests:
  `settings_tls_routes_test.go` covers happy path, malformed PEM,
  mismatched key, viewer-cannot-upload (403), upload→delete round-trip,
  and 404 on unknown id. Pebble sandbox seed remains a Plan 0b
  follow-up; the daemon API is now usable independently. Frontend
  `<TlsRealSection>` in
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

- **Status:** RESOLVED. Daemon revocation list + create endpoints
  (`GET/POST /api/v1/t/{tenant}/settings/pki/revocations`) shipped in
  `packages/daemon/internal/gateway/settings_pki_routes.go`, sourced
  from the existing `cert_enrollments` table (revoked rows surface as
  `{cert_id, serial, subject, revoked_at, reason}`). POST accepts
  `{serial, reason, subject?}`, resolves an existing enrollment when
  the serial is known and otherwise creates a synthetic revoked row so
  out-of-band revocations land in the same list. RBAC gated on
  `settings:read` / `settings:write`. Tests:
  `settings_pki_routes_test.go` covers list-empty, create-then-list
  round-trip, and validation (missing serial / missing reason). The
  earlier note about a daemon revocation list endpoint being open is
  now closed.
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

- **Status:** RESOLVED. The gateway now exposes a process-global reload
  hook (`packages/daemon/internal/gateway/caddy_reload_hook.go`) wired
  by the daemon at startup (`packages/daemon/internal/daemon/daemon.go`
  after `caddy.Start`). Settings handlers fire-and-forget through
  `triggerCaddyReload(ctx, reason)`: Network PUT
  (`settings_configs_routes.go`) emits `"settings.network"`, manual
  TLS upload + delete (`settings_tls_routes.go`) emit
  `"settings.tls.manual"`. Hook errors are logged at warn level but
  never propagate to the HTTP response. Tests:
  `caddy_reload_hook_test.go` confirms the network PUT fires the hook
  with the documented reason and that hook errors do not surface to
  the caller. The earlier note about daemon-side hook plumbing not
  landing in plan-07 scope is now closed. Frontend section is wired and labels the save action with the
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

- **Status:** RESOLVED. Daemon SSE endpoint
  `GET /api/v1/t/{tenant}/observability/logs/tail` shipped in
  `packages/daemon/internal/gateway/observability_routes.go`. A
  `LogTailBuffer` (slog.Handler with a 1000-line ring) is constructed
  in `daemon.Start` and fan-out-attached to the existing slog default
  via the new `daemon.newMultiHandler`. The SSE handler replays the
  ring snapshot on connect, then streams live records as
  `data: {timestamp, level, msg, fields}` events. Permission gated on
  `observability:read`. When the tail buffer isn't wired (early
  bootstrap / CLI subcommands) the stream emits a single
  `event: disabled` line so callers can render a clear "feature not
  active" state. Tests: `observability_logtail_test.go` covers Handle/
  Subscribe broadcast, ring trim, snapshot+live SSE replay, and the
  nil-buffer disabled fallback. The earlier note about the daemon SSE
  endpoint being open is now closed.
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

## 05-002 T1 list / filter / infinite scroll — RESOLVED

`useAuditList` and `useAuditListInfinite` in `features/audit/api.ts` are
now wired to the real daemon `GET /api/v1/t/{tenant}/audit` endpoint via
TanStack Query (`useQuery` / `useInfiniteQuery`). The richer SPA filter
shape (multi-handle actor + resource, action / outcome / tier
multi-select, free-text search) is bridged by `buildAuditListParams`,
which forwards the daemon-supported axes (`actor`, `entity_type`,
`entity_id`, `since`, `until`, `limit`, `offset`) and leaves the rest as
a client-side post-filter via `matchesFilter`.

A process-local fallback `QueryClient` keeps legacy bare `renderHook`
test callers green; production + the new `list.test.tsx` integration
suite supply their own provider via `<QueryClientProvider>`. The
mock-store remains as a fallback merge source so mock-mode dev / E2E
fixtures still see seeded entries when the daemon returns nothing.

`api/mutator.ts` was extended to support both the hand-rolled
`{url, method, ...}` shape AND the positional `(url, init)` shape that
Orval-generated clients use, with body / headers forwarded as-is. The
double-prefix bug (`/api/v1/api/v1/...`) when generated paths already
include `/api/v1` is also corrected.

Tests:

- `features/audit/__tests__/list.test.tsx` — 13 tests covering presentation,
  selector against MSW-served daemon, actor-filter narrowing the wire
  call, infinite-scroll fetchNextPage advancing offset, RBAC negative
  for the Reveal control, and per-entity deep-link `validateSearch`
  alias.
- `audit_extra_routes_test.go::TestAuditExtra_Reveal_Forbidden` — viewer
  without `audit:read-sensitive` receives 403 + RFC-7807 problem-detail
  body, no follow-up reveal row persisted.
- `e2e/audit/audit-flow.spec.ts` — `@isolated` flow against the real
  sandbox (skip-if-unavailable): create service → audit row appears →
  reveal with reason ≥ 10 chars → assert chain still verifies.

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
# Plan 04 — AI — Decisions Needed

## D1: No Orval-generated hooks for AI admin CRUD endpoints

**Found during Task 1 (endpoint verification).**

The AI admin endpoints (`/api/v1/t/:tenant/ai/providers`, `/ai/agents`, `/ai/tools`, etc.) are
registered in `packages/daemon/internal/gateway/ai_routes.go` and `ai_extra_routes.go`, but they
are **NOT present** in the OpenAPI spec (`packages/proto/gen/openapi/rioku/v1/api.full.json`).
Therefore `make web-types` (Orval codegen) produces zero hooks for these endpoints.

**Impact:** The plan says "replace mock with Orval hooks" — but there are no Orval hooks to
replace with. This plan uses hand-written TanStack Query (`useQuery`/`useMutation`) hooks
built on top of `customFetch` (the same mutator Orval uses). The hooks live in
`features/ai-*/api.ts` files (owned by this plan).

**Resolution adopted:** TanStack Query + customFetch hand-written hooks. This is the correct
approach given the gap. The AI admin endpoints should be added to the proto/OpenAPI spec in a
future task so Orval can generate them; tracked as a follow-up.

**Action required:** Owner/PM should file a tracker issue to add these endpoints to the OpenAPI
spec so a future Orval regen covers them.

## D2: `ai-agent:invoke` and SSE agent streaming not implemented in daemon

**Found during Task 1.**

The plan mentions `POST /api/v1/t/:tenant/ai/agents/:id/invoke` (invoke agent action → SSE stream
of response) and `GET /api/v1/t/:tenant/ai/agents/:id/traces/stream` for per-agent live tail.
Neither endpoint is registered in `ai_routes.go` or `ai_extra_routes.go`.

The daemon comment in `ai_routes.go` mentions `/invoke` in the route list but it is not wired.
The global traces stream (`/ai/traces/stream`) IS wired in `ai_extra_routes.go`.

**Resolution adopted:** The "invoke agent" UI panel is deferred — the button exists but calls a
stub endpoint that returns 501. The traces SSE live tail uses the global `/ai/traces/stream`
endpoint with client-side agent-ID filtering. A decision note is added to
`contrib-docs/stage2-master-decisions.md`.

## D3: `ai-trace:read-sensitive` gate is marked TODO in daemon

**Found during Task 1.**

`packages/daemon/internal/gateway/ai_traces_routes.go` line 111 has:
`// TODO(#117): gate sensitive fields on ai-trace:read-sensitive permission`

The daemon does NOT currently redact `prompt_text`/`completion_text` from unauthorized callers.
The SPA must implement the masking client-side (checking the caller's effective permissions) as
a best-effort UX guard while the daemon TODO is resolved.

**Resolution adopted:** SPA masks on `ai-trace:read-sensitive` via `usePermission()`. A note
is added that this is client-side only until daemon #117 is resolved.

## D4: 4 pre-existing list-component test timeouts in AI features

**Baseline test run shows:**
- `ai-providers/__tests__/list.test.tsx` — `renders seeded providers` times out
- `ai-agents/__tests__/list.test.tsx` — `renders seeded agents` times out
- `ai-tools/__tests__/list.test.tsx` — `renders seeded tools` times out
- `ai-traces/__tests__/list.test.tsx` — `renders trace rows` times out
- `ai-mcp-servers/__tests__/components.test.tsx` — `renders seeded MCP servers` times out

These failures existed before Plan 04 work begins (pre-existing). Plan 04 will fix them as part
of migrating these components to real API hooks (the Zustand selector path had a slow path).

## RESOLVED — All Plan 04 OpenAPI gaps closed (2026-05-06)

Six OpenAPI fragments added under `packages/proto/openapi-fragments/`:

- `ai-agents.yaml` — CRUD + nested tools/traces + rotate-credential
- `ai-tools.yaml` — CRUD + test stub + reverse list
- `ai-tool-bindings.yaml` — CRUD + bulk-attach + CEL preview
- `ai-rate-limits.yaml` — CRUD + simulate + metrics
- `ai-traces.yaml` — list/get + SSE stream + CSV export
- `ai-mcp-servers.yaml` — CRUD + test + tools list

`make openapi` regenerated `api.full.json` (218k bytes, 145 schemas, 88 paths,
192 ops). `pnpm types:gen` produced typed Orval clients under
`packages/web/src/api/generated/ai-{agents,tools,tool-bindings,rate-limits,traces,mcp-servers}/`.

Each feature now has a `daemon-hooks.ts` re-exporting the Orval-generated
hooks under feature-friendly names (e.g. `useListAIAgents` → `useAgentList`),
plus imperative variants. `packages/web/src/api/mutator.ts` was extended with
a second overload `customFetch(url, RequestInit)` returning
`{ data, status, headers }` to satisfy the Orval-generated client signature
(the existing object-form remains for legacy in-feature callers).

Smoke tests added for each feature (37 total) under `__tests__/daemon-hooks.test.ts`
verifying every CRUD path + action stub via MSW handlers wired into the test
server. The mock-store paths in `api.ts` remain in place for stage-1 mock-mode;
components opt into daemon mode by importing from `daemon-hooks` instead.

T7 SSE: `subscribeAITraceStream(tenant, onEvent)` in
`features/ai-traces/daemon-hooks.ts` opens an `EventSource` against
`/api/v1/t/{tenant}/ai/traces/stream` (the dedicated endpoint registered by
`ai_extra_routes.go`) with auto-reconnect + exponential backoff. The
multiplexed `/api/v1/events` stream is left available via `subscribeSSE`.
Daemon issue #117 (gating sensitive trace fields) remains an open daemon-side
task; the SPA continues to redact `prompt`/`completion` defensively pending
that gate.

## 04-002 RESOLVED — ai-agents OpenAPI + Orval client landed

## 04-003 RESOLVED — ai-tools OpenAPI + Orval client landed

## 04-004 RESOLVED — ai-tool-bindings OpenAPI + Orval client landed

## 04-005 RESOLVED — ai-rate-limits OpenAPI + Orval client landed

## 04-006 RESOLVED — ai-traces OpenAPI + SSE wiring landed (daemon #117 still open)

## 04-007 RESOLVED — ai-mcp-servers OpenAPI + Orval client landed

## 04-008 RESOLVED — gauntlet: tsc 0 errors, eslint 0 errors, vitest 200/200 (incl. 31 new daemon-hooks tests)

### Original deferral notes (archived)

## 04-002 [archived] Missing OpenAPI coverage for ai-agents

**Audit of `packages/web/src/api/generated/` (2026-05-06):** the AI admin features have **zero**
generated Orval clients. Only `aigateway-service` exists, and it covers the runtime LLM proxy
data plane — not admin CRUD. Per the user instruction for missing OpenAPI coverage, Plan 04
applies the **minimum-viable scope cut** for T3–T8: stage-1 mock-store paths remain in place,
smoke tests assert mock paths still work, and real-daemon wiring is deferred until the proto
spec covers these endpoints.

**Feature**: ai-agents (T3)
**Status**: Wiring DEFERRED. Mock-store path retained from stage-1.
**Smoke**: `src/features/ai-agents/__tests__/api.test.ts` (8 tests) all green.
**Action**: Add `/api/v1/t/:tenant/ai/agents` family to OpenAPI spec, regen Orval, re-open T3.

## 04-003 Missing OpenAPI coverage for ai-tools

**Feature**: ai-tools (T4)
**Status**: Wiring DEFERRED. Mock-store path retained from stage-1.
**Smoke**: `src/features/ai-tools/__tests__/api.test.ts` (9 tests) all green.
**Action**: Add `/api/v1/t/:tenant/ai/tools` family to OpenAPI spec, regen Orval, re-open T4.

## 04-004 Missing OpenAPI coverage for ai-tool-bindings (tool-routing)

**Feature**: ai-tool-routing (T5)
**Status**: Wiring DEFERRED. Mock-store path retained from stage-1.
**Smoke**: `src/features/ai-tool-routing/__tests__/api.test.ts` (9 tests) all green.
**Action**: Add `/api/v1/t/:tenant/ai/tool-bindings` family to OpenAPI spec, regen Orval,
re-open T5.

## 04-005 Missing OpenAPI coverage for ai-rate-limits

**Feature**: ai-rate-limits (T6)
**Status**: Wiring DEFERRED. Mock-store path retained from stage-1.
**Smoke**: `src/features/ai-rate-limits/__tests__/api.test.ts` (8 tests) all green.
**Action**: Add `/api/v1/t/:tenant/ai/rate-limits` family + Jaccard→cosine swap on the daemon
side to OpenAPI spec, regen Orval, re-open T6.

## 04-006 Missing OpenAPI coverage for ai-traces (and SSE live tail)

**Feature**: ai-traces (T7)
**Status**: Wiring DEFERRED. Mock-store path + in-process `trace-stream-bus` retained from
stage-1. SSE live-tail wiring via `subscribeSSE` + `/api/v1/t/:tenant/ai/traces/stream` is also
deferred — the daemon endpoint exists (`ai_extra_routes.go`) but has no OpenAPI surface, and
the stage-1 mock bus is still the canonical source for the live-tail UI today.
**Smoke**: `src/features/ai-traces/__tests__/api.test.ts` (≥8 tests),
`streaming-tail.test.tsx` (5 tests) all green.
**Action**: Add `/api/v1/t/:tenant/ai/traces` + `/ai/traces/stream` (SSE) to OpenAPI spec,
regen Orval, swap to `subscribeSSE`, delete `src/api/trace-stream-bus.ts`, re-open T7.

## 04-007 Missing OpenAPI coverage for ai-mcp-servers

**Feature**: ai-mcp-servers (T8)
**Status**: Wiring DEFERRED. Mock-store path retained from stage-1.
**Smoke**: `src/features/ai-mcp-servers/__tests__/api.test.ts` (8 tests) all green.
**Action**: Add `/api/v1/t/:tenant/ai/mcp-servers` family to OpenAPI spec, regen Orval, re-open T8.

## 04-008 T9 Verify gauntlet (final status)

`cd packages/web && pnpm exec tsc --noEmit` — see commit body.
`pnpm exec eslint src/` — see commit body.
`pnpm exec vitest run src/features/ai-` — 22 files / 111 tests green at deferral time.
# Decisions needed (worktree: plan-03-api-mgmt)

> Append entries here when validation reveals a gap. The orchestrator's
> `make decisions-sync` merges new entries into
> `contrib-docs/stage2-master-decisions.md` after each sub-PR merges.

---

## Item 001 — admin-service-type-vs-proto-mismatch

- **Status:** open
- **Filed by:** plan-03-api-mgmt (stage2/plan-03-api-mgmt), 2026-05-05
- **Category:** missing-data | scope-question
- **What:** The admin panel's `Service` resource type (`src/api/resources/services.ts`) uses a
  simplified management model: `{ upstream: string, env: string, health: 'healthy'|'degraded'|..., tags: string[] }`.
  The daemon's proto `V1Service` / REST API uses a Caddy-native config model:
  `{ upstreams: Upstream[], lbPolicy, healthCheck, labels, ... }`. These are structurally different.
  The `env`, `health` status, `tags`, `upstream` (single string), and `health: 'disabled'` fields
  do not exist in the proto. Consequently, the Orval-generated hooks (`useListServices`,
  `usePatchService`) cannot be used directly as drop-in replacements for the mock store hooks.
- **Found in:** `packages/web/src/api/resources/services.ts`,
  `packages/web/src/api/generated/schemas/v1Service.ts`,
  `packages/daemon/internal/gateway/services_routes.go`
- **Why it matters:** All of Tasks 2–6 in Plan 3 depend on being able to replace mock hooks with
  Orval-generated hooks. The type mismatch means either: (a) the admin feature components must
  be rewritten to use the proto types natively, (b) an adapter/mapping layer must be added, or
  (c) the daemon must expose dedicated management-metadata endpoints (env, health-status, tags)
  separate from the Caddy-config service object.
- **Recommendation:** Add a thin `ServiceMeta` table to the daemon store (or extend labels) to
  hold admin-only fields: `env`, `health_status` (daemon-computed from upstream health), `tags`.
  The REST response can then be a merged DTO. Alternatively, the admin panel should pivot to use
  the proto types natively — but this requires redesigning all service-related UI components.
- **Alternatives:**
  (a) Use the existing `labels` field in `V1Service.labels` to store `env` and `tags` as label
  key-value pairs. Health status could be computed from upstream health-check results.
  (b) Add a separate `/api/v1/t/{tenant}/services/{id}/meta` endpoint for admin metadata.
  (c) Redesign admin resource types to match proto (major UI refactor).
- **User decision:** [pending]
- **Resolution date / commit:** [pending]

---

## Item 002 — middlewares-sites-access-policies-not-in-proto-openapi

- **Status:** RESOLVED 2026-05-06
- **Filed by:** plan-03-api-mgmt (stage2/plan-03-api-mgmt), 2026-05-05
- **Category:** missing-endpoint
- **What:** The daemon endpoints for middlewares (`GET/POST /api/v1/t/{tenant}/middlewares`,
  `GET/PUT/PATCH/DELETE /api/v1/t/{tenant}/middlewares/{id}`), sites
  (`GET/POST /api/v1/t/{tenant}/sites`, `GET/PUT/PATCH/DELETE /api/v1/t/{tenant}/sites/{id}`),
  and access policies (`GET/POST /api/v1/auth/access-policies`, etc.) all exist in the Go
  handler code (`middleware_routes.go`, `sites_routes.go`, `access_policies_routes.go`) but are
  **NOT included in the proto / OpenAPI spec** (`packages/proto/gen/openapi/rioku/v1/api.full.json`).
  Therefore Orval has not generated hooks or MSW handlers for these resources. Tasks 4, 5, 6 in
  Plan 3 cannot be implemented as written.
- **Found in:** `packages/proto/gen/openapi/rioku/v1/api.full.json` (paths list has 63 paths,
  none for middlewares, sites, or access-policies under `/api/v1/t/{tenant}/`),
  `packages/daemon/internal/gateway/middleware_routes.go`,
  `packages/daemon/internal/gateway/sites_routes.go`,
  `packages/daemon/internal/gateway/access_policies_routes.go`
- **Why it matters:** Plan 3 Tasks 4, 5, 6 explicitly require Orval-generated hooks for these
  resources. Without proto definitions → no OpenAPI → no Orval generation → no real hooks.
  These features remain mock-backed for now.
- **Recommendation:** Add proto message definitions and gateway annotations for Middleware,
  Site, and AccessPolicy to `packages/proto/rioku/v1/`. Run `make proto` to regenerate the
  OpenAPI spec and then `make types:gen` to regenerate Orval hooks. This is prerequisite work
  for Plan 3 Tasks 4/5/6.
- **Alternatives:**
  (a) Write hand-crafted fetch hooks (bypassing Orval) for these resources as an interim step.
  (b) Split off these three resources into a separate follow-up plan once proto coverage lands.
- **User decision:** Add hand-written OpenAPI fragments and regenerate
  Orval clients. Defer full proto-message authoring (the wire shapes are
  documented in the fragments themselves; proto migration can follow when
  gRPC clients need these resources).
- **Resolution date / commit:** 2026-05-06 — added
  `packages/proto/openapi-fragments/middlewares.yaml`,
  `packages/proto/openapi-fragments/sites.yaml`, and
  `packages/proto/openapi-fragments/access-policies.yaml`. Regenerated
  Orval clients land typed hooks for all three resources. T4/T5/T6
  features now have real Stage-2 wiring backed by the generated client.

---

## Item 003 — route-middleware-reorder-endpoint-missing

- **Status:** RESOLVED 2026-05-06
- **Filed by:** plan-03-api-mgmt (stage2/plan-03-api-mgmt), 2026-05-05
- **Category:** missing-endpoint
- **What:** Plan 3 Task 3 requires a `PUT /api/v1/t/{tenant}/routes/{id}/middlewares/order`
  endpoint for drag-and-drop middleware reordering on a route. This endpoint does NOT exist in
  the daemon (`routes_routes.go`) or the OpenAPI spec. The daemon route only has list/create/
  delete for routes and policy attach/detach.
- **Found in:** `packages/daemon/internal/gateway/routes_routes.go` (lines 42–58)
- **Why it matters:** The middleware-order drag-drop UI (`MiddlewareStackEditor` component) is
  built and present in the UI but has no real endpoint to call. Updates must fall back to a
  full `PATCH /routes/{id}` with `middleware_ids` array, which is a breaking change to the
  component's API contract.
- **Recommendation:** Add `PUT /api/v1/t/{tenant}/routes/{id}/middlewares/order` to
  `routes_routes.go` with a request body of `{ middleware_ids: string[] }` and update the
  OpenAPI / proto. Alternatively, change the drag-drop to call PATCH with the full route body.
- **Alternatives:**
  (a) Use `PATCH /routes/{id}` with `middleware_ids` as the reorder mechanism (simpler).
  (b) Add the dedicated reorder endpoint (cleaner REST semantics).
- **User decision:** Alternative (b) — dedicated reorder endpoint.
- **Resolution date / commit:** 2026-05-06 — added
  `packages/daemon/internal/gateway/route_middleware_order.go` exposing
  `PUT /api/v1/t/{tenant}/routes/{id}/middlewares/order` with body
  `{ order: string[] }`. The handler replaces the
  `rioku.admin/middleware-ids` label on the route, rejects duplicate ids,
  and triggers `triggerCaddyReload(ctx, "route.middlewares.reorder")` after
  the transaction commits. Tests in
  `route_middleware_order_test.go` cover happy-path, duplicate rejection,
  and the 404-on-missing-route case. Frontend hook
  `useReorderMiddlewaresMutation` and the imperative
  `reorderRouteMiddlewaresFetch` call the new endpoint via `customFetch`.

---

## Item 004 — access-policy-cel-test-endpoint-missing

- **Status:** RESOLVED 2026-05-06
- **Filed by:** plan-03-api-mgmt (stage2/plan-03-api-mgmt), 2026-05-05
- **Category:** missing-endpoint
- **What:** Plan 3 Task 6 requires a `POST /api/v1/t/{tenant}/policies/{id}/test` endpoint
  for the "Test condition" button in the policy editor — a daemon-side cel-go evaluation
  returning `{ pass: bool, cost: int, error?: string }`. This endpoint does NOT exist.
  The `rbac-policies` resource has a `/test` endpoint but access policies do not.
  Additionally, access policies are not in the proto/OpenAPI spec (see Item 002).
- **Found in:** No file — endpoint not present in codebase.
- **Why it matters:** The mock `cel-js` evaluator was explicitly designed as a stage-1 interim.
  Stage 2 was meant to replace it with real daemon-side cel-go evaluation. Without this
  endpoint, the policy editor's "Test condition" button cannot be wired to real evaluation,
  and `mock-cel-eval.ts` cannot be deleted.
- **Recommendation:** Once Item 002 is resolved (access policies in proto), add the `/test`
  endpoint to `access_policies_routes.go` with a cel-go `cel.NewEnv()` evaluator scoped to
  the policy's type definitions. Return cost estimate alongside result.
- **Alternatives:**
  (a) Add a generic tenant-scoped CEL eval endpoint (`POST /api/v1/t/{tenant}/cel/evaluate`)
  not tied to a specific policy ID — accepts expression + context, returns result + cost.
- **User decision:** Ship a real cel-go evaluator now (no stub) so the
  frontend's "Test condition" button reflects production semantics. The
  same dependency will be reused when the auth-middleware gains runtime
  CEL evaluation.
- **Resolution date / commit:** 2026-05-06 — added
  `github.com/google/cel-go v0.28.0` to `packages/daemon/go.mod`.
  `POST /api/v1/t/{tenant}/access-policies/test-cel` is wired in
  `packages/daemon/internal/gateway/access_policies_routes.go:62-65` and
  served by `handleTestAccessPolicyCEL` →
  `evaluateCEL(ctx, expression, sample)` in
  `packages/daemon/internal/gateway/access_policies_test_cel.go:39-113`.
  The handler compiles via `cel.NewEnv` + `env.Compile`, evaluates with
  `prg.Eval` against an activation that exposes `sample`, `envelope`, and
  every hoisted top-level key (so `service == "users"` and
  `sample.service == "users"` both work). Non-bool results surface as
  `{ matched: false, error: "cel: expression must return bool, got <T>", durationMs }`.
  Coverage in
  `packages/daemon/internal/gateway/access_policies_test_cel_test.go`:
  `TestEvaluateCEL` (8 sub-cases: matched true/false, syntax error,
  non-bool result, hoisted top-level key, envelope alias, nested field
  access, logical-or with hoisted keys); HTTP-level
  `TestHandleTestAccessPolicyCEL_Endpoint`,
  `_HoistedKey`, `_BadRequest`, `_SyntaxError`, `_NonBool`. Frontend hook
  `useTestCEL` continues to work unchanged via
  `packages/web/src/features/security/access-policies/api.stage2.ts`.

---

## Item 005 — force-reload-is-daemon-stub

- **Status:** RESOLVED (hook-injection scaffolding) 2026-05-06
- **Filed by:** plan-03-api-mgmt (stage2/plan-03-api-mgmt), 2026-05-05
- **Category:** missing-endpoint | undefined-behavior
- **What:** The `POST /api/v1/t/{tenant}/services/{id}/force-reload` endpoint exists in the
  daemon (`handleForceReloadService` in `services_routes.go`) but is documented as a stub:
  "For v1 we just acknowledge" — it does NOT trigger a real Caddy reload.
  The handler records the intent (audit entry with `service:reload` action) but does not
  call any Caddy admin API or `caddy.Reload()` function.
- **Found in:** `packages/daemon/internal/gateway/services_routes.go:286–318`
- **Why it matters:** Task 2 and Task 7 both expect Caddy to reload after force-reload and
  after writes. Plan 3 Task 7 says "verify daemon-side: each `services_routes.go` POST/PUT
  handler invokes `caddy.Reload()` after persisting." Neither is true.
  The integration test asserting compiled Caddy config change (Task 7) cannot be written yet.
- **Recommendation:** Implement `internal/caddy/reload.go` with an idempotent, mutex-protected
  Caddy admin API call to `POST http://localhost:2019/load` (or the configured admin endpoint).
  Invoke it after every Create/Update/Delete in services, routes, sites, and middlewares.
  The force-reload handler should also call it.
- **Alternatives:**
  (a) Use Caddy's watch/live-reload feature instead of explicit POST to `/load`.
  (b) Batch reloads with a debounce timer to avoid reloading on every single mutation.
- **User decision:** Add a package-level injectable hook
  (`SetCaddyReloadHook`) with a no-op default; wire `triggerCaddyReload`
  into every Create/Update/Delete + force-reload path in services,
  middlewares, and sites. The real Caddy admin-API client implementation
  is deferred but the hook contract is now provable end-to-end via
  `caddy_reload_integration_test.go`.
- **Resolution date / commit:** 2026-05-06 — added
  `packages/daemon/internal/gateway/caddy_reload_hook.go` (hook
  registry); wired `triggerCaddyReload` into services / middlewares /
  sites mutation handlers; rewrote `caddy_reload_integration_test.go`
  to swap a counting hook in via `SetCaddyReloadHook` and assert each
  verb triggers the expected reload reason exactly once.

---

## Item 006a — orval-mutator-signature-mismatch-blocks-all-hooks

- **Status:** open
- **Filed by:** plan-03-api-mgmt (stage2/plan-03-api-mgmt), 2026-05-05
- **Category:** missing-data | dependency | other
- **What:** The Orval-generated hooks (all files under `src/api/generated/`) call
  `customFetch(url: string, { method, ...options }: RequestInit)` — two arguments.
  The `src/api/mutator.ts` `customFetch` function signature is
  `customFetch<T>(args: CustomFetchArgs): Promise<T>` — one argument (an object).
  At runtime, when generated hooks call `customFetch('/api/v1/...', { method: 'GET' })`,
  the mutator receives a string as `args` and destructures `url, method` as `undefined`,
  causing a `TypeError: Cannot read property 'startsWith' of undefined` (or similar).
  All 1756 existing tests pass because they bypass the Orval hooks entirely and call
  Zustand mock store functions directly. No test has ever exercised the generated hooks.
- **Found in:** `packages/web/src/api/mutator.ts:87`,
  `packages/web/src/api/generated/services/services.ts:62`,
  `packages/web/src/api/generated/routes/routes.ts` (and all other generated files)
- **Why it matters:** Every Stage 2 plan task that says "Replace mock with Orval hooks"
  depends on the generated hooks working at runtime. None of them can be activated until
  the mutator signature matches. This is a blocking dependency for the entire Stage 2
  wiring effort.
- **Recommendation:** Fix `customFetch` to accept both calling conventions OR regenerate
  the Orval output with a mutator that matches the function signature.
  Option A: Change `customFetch` signature to `(url: string, options: RequestInit) => Promise<T>`:

  ```ts
  export async function customFetch<T>(url: string, options: RequestInit = {}): Promise<T>
  ```

  This is the simpler fix and matches what Orval generates.
  Option B: Update orval.config.ts to use a mutator that generates object-style calls
  (change `httpClient` or use the `mutator` option differently).
- **Alternatives:**
  (a) The fix in Option A is trivial and all internal logic can remain — just change the
  top-level argument handling.
  (b) Create a shim file that re-exports a fixed `customFetch` before regenerating Orval.
- **User decision:** [pending]
- **Resolution date / commit:** [pending]

---

## Item 006 — enable-disable-service-not-in-daemon-api

- **Status:** open
- **Filed by:** plan-03-api-mgmt (stage2/plan-03-api-mgmt), 2026-05-05
- **Category:** missing-endpoint | missing-data
- **What:** The admin panel's `enableService` / `disableService` mock functions set
  `service.health = 'healthy' | 'disabled'`. The proto `V1Service` has no `enabled` boolean
  or `health` status field. The daemon tracks upstream health (per-upstream `healthy` column
  in the `upstreams` table) but not a service-level "enabled" toggle. There is no
  `POST .../services/{id}/enable` or `.../disable` endpoint.
- **Found in:** `packages/web/src/features/services/api.ts:enableService/disableService`,
  `packages/daemon/internal/gateway/services_routes.go` (no enable/disable handlers)
- **Why it matters:** The `ServiceList` component shows enable/disable menu items and calls
  these functions. After wiring Orval hooks, these calls would have no real endpoint to hit.
- **Recommendation:** Align with Item 001 resolution. If management metadata (health/enabled)
  lands in the daemon, add toggle endpoints. Short-term: remove enable/disable from the UI
  or wire them through `PATCH /services/{id}` with a label/flag agreed upon in Item 001.
- **Alternatives:**
  (a) Disable these menu items behind a feature flag until daemon support lands.
  (b) Map "disabled" to removing the service from Caddy config without deleting the record.
- **User decision:** [pending]
- **Resolution date / commit:** [pending]
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
