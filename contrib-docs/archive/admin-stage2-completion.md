# Admin Stage-2 Completion

Stage 2 wired the Mantine admin SPA at `:7778` to the real Rioku daemon. The
mock-store / mock-seed code paths have been retired, the
`VITE_USE_MOCKS=false` flip is the only mode of operation, and the
sandbox-bypass carve-out from Stage 1 has been removed.

This document supersedes the old `admin-stage2-entry.md` (entry checklist).

## Status

- **Date complete:** 2026-05-07
- **Branch:** `stage2/main` (merged from `stage2/plan-13-closeout`)
- **Sandbox:** required for all admin development; no carve-outs remain.

## Plans delivered

Stage 2 shipped across 4 foundation plans, 12 feature plans, and one close-out.

### Foundation

| Plan | Scope |
| --- | --- |
| `00a` | Codegen + SPA foundation — Orval pipeline, mutator, `customFetch` dual-signature, generated client surface under `packages/web/src/api/generated/` |
| `00b` | Sandbox refactor — sandbox seed + smoke harness rebuilt for real-daemon validation, mailpit/Pebble integrations |
| `00c` | Daemon endpoints — endpoint manifest at `contrib-docs/admin-stage2-endpoint-manifest.md`; every admin-facing route classified `EXISTS` (4 documented out-of-scope `EXISTS-INCOMPLETE` entries) |
| `00d` | Tooling + governance — eslint-plugin-boundaries layout, decisions-sync flow, worktree-doctor, hook injection scaffolding |

### Feature plans

| Plan | Surface | Notable artefacts |
| --- | --- | --- |
| `01` | Auth, TOTP, SMTP, SSE | login + TOTP enrol/verify, SMTP-backed reset/invite, SSE client at `src/api/sse-client.ts` |
| `02` | Identity | users / roles / sessions / api-keys / RBAC + super-admin impersonation |
| `03` | API management | services / routes / middlewares / sites / access-policies (proto-native via OpenAPI fragments) |
| `04` | AI | providers / agents / tools / tool-bindings / rate-limits / traces (SSE) / MCP servers |
| `05` | Audit | full Orval surface, sensitive-fields reveal, retention config, CSV/JSONL streaming export, Playwright |
| `06` | Notifications | inbox SSE, channels (SMTP/webhook/slack), routing dispatcher, delivery log |
| `07` | Settings | 9 sections (Profile, Tenant, Authentication, Network, PKI, TLS, Observability, Integrations, Plugins, Danger zone) including TLS/PKI |
| `08` | Dashboards | PromQL AST, widget kinds, default + personal home dashboards |
| `09` | Plugins | sideload + dev-mode gate + permission registry |
| `10` | Cluster | nodes / enrollment tokens, full-page detail with Overview/Metrics/Audit |
| `11` | Super-admin | tenant inventory + cross-tenant users + admin audit log |
| `12` | Subdomain tenancy | `parent_domain`, cookie domain, wildcard cert via Caddy compiler |
| `13` | Close-out | mock-store retirement, doc refresh, decisions reconciliation |

## Deliverables — where to find them

- **Generated REST clients:** `packages/web/src/api/generated/`
- **Mutator (dual-shape):** `packages/web/src/api/mutator.ts`
- **SSE client:** `packages/web/src/api/sse-client.ts`
- **Endpoint manifest:** `contrib-docs/admin-stage2-endpoint-manifest.md`
- **Sandbox harness:** `make sandbox`, `make sandbox-test-smoke`
- **E2E specs:** `packages/web/e2e/`
- **Bundle audit:** `packages/web/BUNDLE_AUDIT.md`
- **Decisions log:** `contrib-docs/stage2-master-decisions.md` (synced from per-worktree `decisions-needed.md` files)

## Out-of-scope follow-ups

These were deliberately deferred past Stage 2; tracked as `post-stage-2`
GitHub issues:

- Daemon-side PromQL proxy (admin currently reads metrics directly from configured Prometheus).
- Global cross-tenant `/api/v1/plugins` index (per-tenant `/api/v1/t/{tenant}/plugins` is fully implemented).
- Server-side `effective-permissions` join (client-side join is correct and cheap; revisit when conditional resolution lands).
- Formal `ServiceMeta` schema vs label-key contract for admin-only metadata.
- Per-section audit-emission Vitest assertions in settings (Plan 05 endpoints now exist; tests can be authored).

## Stage-1 archive

Stage-1 audit documents have moved to `contrib-docs/_archive/`:

- `_archive/stage1-comprehensive-audit.md`
- `_archive/stage1-refinement-audit.md`

## Operating contract going forward

- **Sandbox is mandatory** for all admin development. There is no mock-only mode.
- **Real-API only** in `packages/web` — no `useMockStore`, no mock-seed imports.
- **Schema-change discipline:** any proto / OpenAPI fragment change must regenerate Orval clients (`make types:gen`) and refresh the endpoint manifest.
- **Sandbox refresh cadence** (per the test-execution decision doc) applies to every sprint tie-off, schema migration, and new Caddy primitive.
