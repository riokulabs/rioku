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
