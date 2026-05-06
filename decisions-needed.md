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
