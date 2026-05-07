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
