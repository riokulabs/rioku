# Bundle Audit — Plan 9 Task 9b.6

Recorded: 2026-04-20  
Vite 8 / Rolldown (beta)  
Build: `pnpm build` from `packages/web/`

---

## Main Entry

| File | Raw | Gzip |
|------|-----|------|
| `index-[hash].js` | 286 KB | 91 KB |

The entry script bootstraps TanStack Router's route tree, mounts the React app, and
registers all top-level route definitions.  Because TanStack Router's code-splitting
requires the preload helper (see § Scalar note below) to be evaluated at startup, the
entry has a static dependency on the `scalar` chunk even though the Scalar UI itself
is never instantiated on page load.

---

## Top 15 Chunks by Gzip Size

| Rank | Chunk | Raw | Gzip | Main-bundle path? | Purpose |
|------|-------|-----|------|-------------------|---------|
| 1 | `scalar-[hash].js` | 3,101 KB | 922 KB | **Yes** (Rolldown artifact — see §) | Scalar API reference + Vue runtime + bundled Zod |
| 2 | `mantine-core-[hash].js` | 393 KB | 120 KB | Yes (static dep) | Mantine UI components + hooks |
| 3 | `AreaChart-[hash].js` | 361 KB | 106 KB | No (lazy) | @mantine/charts — dashboard widgets |
| 4 | `index-[hash].js` | 286 KB | 91 KB | Entry | App bootstrap + route tree |
| 5 | `shiki-[hash].js` | 575 KB | 88 KB | No (lazy) | Syntax highlighting |
| 6 | `dashboards-[hash].js` (large) | 192 KB | 54 KB | No (lazy) | Dashboard builder canvas |
| 7 | `AgentScalarChatInterface.vue-[hash].js` | 145 KB | 43 KB | No (lazy) | Scalar internal Vue component (agent-chat package) |
| 8 | `cel-[hash].js` | 152 KB | 43 KB | No (lazy) | CEL condition editor |
| 9 | `settings-[hash].js` (large) | 174 KB | 42 KB | No (lazy) | Full settings section |
| 10 | `tanstack-[hash].js` | 136 KB | 40 KB | Yes (static dep) | TanStack Router + Query + Table |
| 11 | `mock-seed-[hash].js` | 53 KB | 18 KB | No (lazy) | Mock data seed (dev/stage-1 only) |
| 12 | `zod-[hash].js` | 58 KB | 13 KB | No (lazy) | Zod mini schema library (extracted from scalar) |
| 13 | `plugins-[hash].js` | 43 KB | 13 KB | No (lazy) | Plugin management pages |
| 14 | `DatePickerInput-[hash].js` | 44 KB | 11 KB | No (lazy) | Mantine date picker |
| 15 | `agents-[hash].js` | 32 KB | 10 KB | No (lazy) | AI agents list/detail page |

---

## Lazy-loaded Chunks

| Chunk | Gzip | Loaded when |
|-------|------|-------------|
| `scalar-[hash].js` | 922 KB | **Immediately at startup** (Rolldown static dep — see §) |
| `AreaChart-[hash].js` | 106 KB | Dashboard widgets are rendered |
| `shiki-[hash].js` | 88 KB | Syntax-highlighted code blocks |
| `dashboards-[hash].js` (large) | 54 KB | `/t/*/dashboards/*/edit` |
| `AgentScalarChatInterface.vue-[hash].js` | 43 KB | `/t/*/ai/agents` (via scalar agent-chat) |
| `cel-[hash].js` | 43 KB | CEL condition editor |
| `settings-[hash].js` | 42 KB | `/t/*/settings/*` |
| `zod-[hash].js` | 13 KB | `/t/*/ai/agents` (dep of AgentScalarChatInterface) |
| `monaco-[hash].js` | 5 KB | Network Caddy editor, advanced config editor |
| `api-explorer-[hash].js` | 5 KB | `/t/*/api-explorer` route stub |

---

## Scalar in the Main-Bundle Path — Root Cause

**Expected behaviour:** The `scalar` chunk should only be fetched when a user visits
`/t/$tenant/api-explorer`.  The source-code boundary is correct:
`src/routes/t.$tenant/api-explorer.tsx` wraps the component with
`lazyRouteComponent(() => import('@/features/api-explorer'), 'ApiExplorer')`.

**Actual behaviour (Rolldown artifact):** Vite 6 / Rolldown assigns its internal
`__vitePreload` helper to the first non-entry manualChunk it encounters during
processing.  Because the `scalar` manualChunk is processed early, the helper lands in
`scalar-[hash].js`.  The entry `index-[hash].js` must then statically import this
helper from the scalar chunk so it can register the modulepreload hints required for
all other lazy routes.  As a result `scalar-[hash].js` appears in the HTML's
`<link rel="modulepreload">` list and is parsed immediately on page load.

**Impact:** The browser downloads and parses ~922 KB (gzipped) of JavaScript on every
page load, not just on `/api-explorer` visits.  However, the *execution* of Scalar's
Vue components is still deferred; no Scalar UI is instantiated until the user
navigates to the explorer route.  TTI is slightly increased by the parse cost but
rendering is unaffected.

**Zod sub-issue:** The `scalar` chunk also bundles the full Zod v4 library (ZodType,
z.string, z.object, …) because `@scalar/types` (an indirect dep of
`@scalar/api-reference-react`) lists `zod` in its own `node_modules`.  pnpm's virtual
store means this copy lives at a different path than the app's own zod, making it
invisible to the manualChunks interceptor.  The `zod` manualChunk added in this task
successfully extracted `zod-mini` (used by `@scalar/agent-chat`) — reducing
`AgentScalarChatInterface.vue` from 202 KB to 145 KB raw — but the main ZodType
export remains inside scalar due to the pnpm path isolation.

**Fix status:** This is a known Rolldown beta limitation.  Fixing it would require
either (a) waiting for Rolldown to stabilise manualChunks semantics, (b) using
`build.rolldownOptions.output.codeSplitting` to let Rolldown manage chunk boundaries
automatically, or (c) vendoring/patching `@scalar/api-reference-react` to make Zod an
external peer dependency.  None of these are Stage 1 scope.

---

## Main Bundle Path Chunks > 200 KB Raw (non-lazy)

| Chunk | Raw | Gzip | Notes |
|-------|-----|------|-------|
| `scalar-[hash].js` | 3,101 KB | 922 KB | Rolldown artifact (see §) |
| `mantine-core-[hash].js` | 393 KB | 120 KB | Necessary static dep — Mantine is used on every route |
| `index-[hash].js` | 286 KB | 91 KB | Entry chunk — React + router bootstrap |

All other chunks > 200 KB raw (`AreaChart`, `shiki`, `cel`, `settings`, `dashboards`)
are lazy-loaded and do not affect initial TTI.

---

## Stage-1 Budget Status

```
pnpm check-budgets result:
  ✓ main:         87.7 KB gzipped  (hard cap 1000 KB)
  ✓ mantine-core: 115.8 KB gzipped (hard cap 600 KB)
  ✓ tanstack:      38.9 KB gzipped (hard cap 300 KB)
  ✓ monaco:         4.7 KB gzipped (hard cap 700 KB)
  ✓ shiki:         85.1 KB gzipped (hard cap 400 KB)
  ✓ cel:           42.2 KB gzipped (hard cap 120 KB)
  ⚠ scalar:       891.7 KB gzipped (target 500 KB, hard cap 1000 KB)
  Total:         1896.5 KB gzipped (hard cap 6000 KB)

All chunks within budgets (scalar warning is pre-existing and documented)
```

The scalar budget warning is expected: the package ships its own full Vue runtime and
reference renderer; the hard cap (1000 KB) accounts for this.

---

## Change Made in This Task

Added a `zod` entry to `vite.config.ts` `manualChunks`:

```ts
if (id.includes('/node_modules/zod/') || id.includes('/node_modules/.pnpm/zod@'))
  return 'zod';
```

This successfully extracted `zod-mini` (used by `@scalar/agent-chat`) out of the
`AgentScalarChatInterface.vue` chunk, reducing it from 202 KB → 145 KB raw
(57 KB / 13 KB gz saved).  The main Zod v4 classic library remains inside `scalar`
due to pnpm virtual-store path isolation (see § above).

---

## Recommendations for Stage 2

1. **Scalar true lazy loading:** When real API endpoints are wired up, consider
   whether `@scalar/api-reference-react` can be replaced with a lighter API explorer
   or deferred even further (e.g., user must click a button).  The 922 KB startup
   parse cost is the largest single improvement available.

2. **`build.rolldownOptions.output.codeSplitting`:** Once Rolldown stabilises
   (post-Vite 6 GA), switching to Rolldown's native code-splitting may eliminate the
   `__vitePreload` colocation problem entirely.

3. **AreaChart (106 KB gz):** Already lazy — no action needed.  If dashboards are
   rarely visited, consider also lazy-loading the `@mantine/charts` peer imports.

4. **Mock seed (18 KB gz):** `mock-seed-[hash].js` is a dev/stage-1 artefact.  It
   should be tree-shaken out entirely once real API endpoints land in Stage 2.
