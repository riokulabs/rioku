# Plan 15 — Production mock-store removal (final)

**Branch:** `stage2/plan-15-prod-mockstore`
**Predecessors:** plan-13 (route/hook cleanup), plan-14a (test deletion, PR #232), plan-14b (audit writers + helper restore, PR #233)
**Goal:** Remove all remaining `useMockStore` / `mock-store` / `mock-seed` references from production code in `packages/web/src/`, then delete the stores themselves.

## Starting state (plan-15 branch root)

After plan-14b merge, baseline grep:

```
$ grep -rln 'useMockStore\|mock-store\|mock-seed' packages/web/src --include='*.ts' --include='*.tsx' | wc -l
70
```

Breakdown by area:

| Area | Files | Notes |
|------|-------|-------|
| `api/mock-store/_internal.ts` | 1 | The store itself (Zustand) — deletable last |
| `api/mock-seed/_internal.ts` | 1 | Seed data — deletable last |
| `host/seed-zones.tsx` | 1 | Host-side seed helper |
| `host/plugin-registry.ts` | 1 | Plugin registry helper |
| `host/role-resolver.test.ts` | 1 | Test that reseeds for grant assertions |
| **`features/`** | **65** | Feature backends + components |

Per-feature breakdown:

| Feature | Files | Has `api.stage2.ts`? | Notes |
|---------|-------|-----------------------|-------|
| dashboards | 8 | no | 17.6KB api.ts — full mock backend |
| ai-agents | 6 | no | 17.2KB api.ts — full mock backend |
| sites | 5 | yes | api.ts mock; api.stage2.ts real; **components still on mock** |
| ai-rate-limits | 5 | no | 12.3KB api.ts |
| settings | 4 | no | **49.9KB** api.ts — biggest single file |
| services | 4 | yes | api.ts already proxies to api.stage2; mock-store reads stale (e.g. `useServiceRoutes`) |
| middlewares | 4 | yes | api.ts mock; api.stage2.ts real; **components still on mock** |
| routes | 3 | yes | same shape |
| notification-routing | 3 | — | |
| notification-log | 3 | — | |
| audit | 3 | — | |
| plugins | 2 | — | |
| plugin-signers | 2 | — | |
| notification-channels | 2 | — | |
| cluster | 2 | — | |
| ai-traces | 2 | — | |
| widgets, security, policies, notifications, dashboard-builder, ai-tool-routing, ai-mcp-servers | 1 each | — | |

## Strategy

The work falls into three classes with very different effort profiles:

### Class A — Already-superseded backends (delete, low risk)

`services/api.ts` has the comment "proxies to api.stage2.ts"; some other features have mock-store reads in selectors that are dead alternates to a real Orval hook. For each Class A file:

1. Confirm the real path exists (api.stage2.ts or generated hooks) and is what `index.ts` re-exports as the canonical name.
2. Delete the mock-store-backed selector / mutator.
3. If `api.stage2.ts` exists: collapse it back into `api.ts` (rename, drop `.stage2`), update `index.ts` to single-source.

**Targets in this class:** services (small remaining mock reads), routes, sites, middlewares (the four that have `api.stage2.ts`).

### Class B — Feature backends with no real-path replacement yet (build then swap)

Where there's no `api.stage2.ts` and no canonical real Orval hook, the mock-store path is what the components actually use. Replacing it requires:

1. Confirm the daemon endpoint exists (check `contrib-docs/admin-stage2-endpoint-manifest.md`).
2. Add an OpenAPI fragment under `packages/proto/openapi-fragments/` if missing.
3. Run `pnpm types:gen` to produce Orval hooks under `src/api/generated/`.
4. Rewrite the feature `api.ts` against the generated hooks, preserving the public signatures consumed by components (per the file-ownership §8.4 rule).
5. Update component fixtures / vitest specs to MSW handlers instead of mock-store priming.

**Targets in this class:** dashboards, ai-agents, ai-rate-limits, settings (huge), notification-routing, notification-log, audit (any portions still mock), plugins, plugin-signers, notification-channels, cluster, ai-traces, plus the singletons (widgets, security, policies, notifications, dashboard-builder, ai-tool-routing, ai-mcp-servers).

This is the bulk of the work. Each feature is its own mini-plan because each has its own daemon endpoint set, RBAC story, and SSE/streaming surface.

### Class C — Stores + host helpers (delete last)

Once all feature consumers are off mock-store, delete:

- `src/api/mock-store/_internal.ts`
- `src/api/mock-seed/_internal.ts`
- The barrel files `src/api/mock-store/index.ts` and `src/api/mock-seed/index.ts`
- `host/seed-zones.tsx` (callers from removed plans)
- `host/plugin-registry.ts` mock paths
- `host/role-resolver.test.ts` (rewrite as pure unit test against role-resolver.ts logic without mock-seed)

## Execution order in this branch

Single branch: `stage2/plan-15-prod-mockstore`. Incremental commits, one per logical chunk, all conventional-commit format. No sub-PRs; merges to `stage2/main` once all of plan-15 is complete and CI is green.

1. **Class A pass (commits 1–4):** services, routes, sites, middlewares — collapse api.stage2 into api, delete mock-store paths.
2. **Class B pass (commits 5–N):** one commit per feature, smallest first to build momentum and validate the pattern. Order:
   - cluster (2 files)
   - ai-traces (2 files)
   - notification-channels (2 files)
   - plugins (2 files), plugin-signers (2 files)
   - audit (3), notification-log (3), notification-routing (3)
   - ai-rate-limits (5)
   - ai-agents (6)
   - dashboards (8)
   - settings (4 — but giant api.ts; split by section if needed)
   - singletons (one commit per remaining file)
3. **Class C pass (final commit):** delete stores + host helpers + barrel files. Re-run typecheck + lint + vitest + bundle audit.

## Acceptance criteria (must hold at PR merge)

- `grep -rn 'useMockStore\|mock-store\|mock-seed' packages/web/src` returns **0 matches**.
- `pnpm exec tsc --noEmit` clean.
- `pnpm exec eslint .` clean (verified via `env -u RTK_PROXY_OVERRIDE`).
- `pnpm exec vitest run` — all suites green.
- `pnpm exec playwright test` against `make sandbox` — all specs green.
- `BUNDLE_AUDIT.md` thresholds still met.
- `packages/web/CLAUDE.md` Operating mode block becomes literally true (it currently asserts the cleanup is done; plan-15 is what makes the assertion non-aspirational).

## Out of scope

- Any refactor of generated Orval output (do not edit `src/api/generated/`).
- Any new daemon endpoints — if a feature needs one, it's a blocker, escalate before continuing.
- Backwards-compat shims for tests that still try to seed via mock-store — rewrite the test to use MSW, do not keep the mock-store path on life support for tests.

## Risk register

| Risk | Mitigation |
|------|------------|
| Daemon endpoint gaps for Class B features | Cross-check `admin-stage2-endpoint-manifest.md` per feature before starting; escalate any miss |
| Settings api.ts 49.9KB → many sections | Split into per-section modules during the migration; do not preserve as one file |
| Component fixture rewrites are fixture-heavy | Use `test-utils/` factories already established by plan-11 super-admin tests |
| Bundle weight from real-hook expansion | Run bundle audit at end; chunk-split if any single route grows >threshold |
| Sandbox seed compatibility | Sandbox seed must cover every entity type the real hooks query — verify via smoke test after each feature commit |
