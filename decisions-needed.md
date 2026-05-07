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
