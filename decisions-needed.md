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
