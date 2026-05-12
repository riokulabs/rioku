# packages/web — Rioku Admin SPA

Stage-2 complete. The admin panel is wired to the real Rioku daemon at
`:7778`. The bulk of the SPA (auth, identity, API management, AI, audit,
notifications, plugins, cluster, sites/services/routes/middlewares,
ai-rate-limits, ai-traces) runs against real daemon endpoints. Plan 15
retired mock-store reads from feature components; the remaining
exceptions are listed below.

## Operating mode

- **Real API.** `VITE_USE_MOCKS` is no longer toggled. Most hooks resolve
  through `src/api/mutator.ts → customFetch` against the running daemon.
- **Sandbox required.** All development must validate against `make sandbox`
  (root daemon at `:7778`, SMTP via mailpit, Pebble for ACME).
- **Mock-store deprecation.** New feature code must NOT import
  `src/api/mock-store/`, `src/api/mock-seed/`, or any `useMockStore`
  hook. The few feature `api.ts` files that still consume the store
  (settings, dashboards, dashboard-builder) are scoped to UIs whose
  daemon endpoints have not yet been built (settings sub-CRUD,
  dashboards CRUD + versions, dashboard-builder query engine). Each
  carries a TODO and a tracking link; new sub-features on these
  surfaces should land alongside their daemon endpoints, not extend
  the mock paths.
- For fixture data, prefer sandbox seed bundles or test factories
  under `src/test-utils/` (where present).

## Tech stack

- **React 19** + **Mantine 9** (no custom design system, no separate
  `packages/ui/` — Mantine is used directly).
- **TanStack Router** + **TanStack Query** for routing and server state.
- **Vite** + **Vitest** + **Playwright** for build, unit, and E2E tests.
- **Orval** generates REST hooks from OpenAPI under
  `src/api/generated/`. Re-run via `make types:gen` (or
  `pnpm types:gen` from `packages/web/`) after any proto / OpenAPI fragment
  change.

## Layout

```
src/
  api/
    generated/        -- Orval output: hooks, schemas, MSW handlers (do not edit)
    mutator.ts        -- customFetch (dual signature: legacy {args} AND positional (url, init))
    sse-client.ts     -- SSE wrapper with Last-Event-ID resume
    mode.ts           -- runtime guard; daemon mode only
  features/<area>/    -- feature folders: api.ts, components/, routes/, __tests__/
  components/         -- shared composites (app-shell, etc.)
  routes/             -- TanStack Router file-based routes
e2e/                  -- Playwright specs (run against `make sandbox`)
eslint-rules/         -- custom rules consumed by eslint.config.mjs
public/               -- static assets
sample-plugin/        -- dev sideload demo plugin
scripts/              -- maintenance / type-gen helpers
```

## Boundaries

`eslint-plugin-boundaries` enforces import direction across `src/`
subdirectories (configured in `eslint.config.mjs`). The high-level rule of
thumb:

- `features/<area>` may import from `api/`, `components/`, shared utils.
- `features/<area-A>` MAY NOT directly import from `features/<area-B>`
  internals — cross-feature data must flow via shared `api/` hooks.
- `api/generated/` is consumed only via the public `api/` surface
  (`mutator.ts` + per-area re-exports). Do not import generated files
  directly from feature components.
- Test files (`__tests__/`, `*.test.ts(x)`) have relaxed boundaries.

If you add a new top-level subdirectory, update the boundaries config in
the same PR.

## Mutator: dual-shape

`customFetch` accepts BOTH calling conventions, and skips the BASE prefix
when the URL is already canonical (`/api/...`):

- Legacy / hand-rolled: `customFetch<T>({ url, method, ...options })`
- Orval-generated: `customFetch(url: string, options: RequestInit)`

This is intentional. Both shapes coexist during the long tail of feature
api.ts files migrating to fully generated hooks. New code SHOULD prefer the
positional Orval shape.

## SSE

Live event surfaces (audit live-tail, AI traces, notifications inbox) use
`src/api/sse-client.ts`. It auto-resumes via `Last-Event-ID` on reconnect
and respects server-sent `retry:` directives. Components subscribe via
small per-feature hooks rather than instantiating raw `EventSource`.

## E2E

Playwright specs live under `packages/web/e2e/` and run against the live
sandbox started by `make sandbox`. The sandbox seed gives them deterministic
users, channels, and tenants. Run locally with:

```bash
SANDBOX_ROOT_PASSWORD=TestRoot1234! make sandbox
pnpm exec playwright test            # from packages/web/
make sandbox-stop
```

CI runs sandbox + Playwright in `test-e2e`. Both are required.

## Common commands

From `packages/web/`:

```bash
pnpm dev                       # Vite dev server (expects daemon on :7778)
pnpm build                     # production bundle
pnpm exec tsc --noEmit         # typecheck
pnpm exec vitest run           # unit tests
pnpm exec eslint .             # lint (verify via env unset RTK_PROXY_OVERRIDE)
pnpm exec playwright test      # E2E (sandbox required)
pnpm types:gen                 # regen Orval clients (after OpenAPI change)
```

## RTK note

`rtk pnpm lint` can mask ESLint output. Verify lint via
`/usr/bin/env -u RTK_PROXY_OVERRIDE pnpm exec eslint .` (or `rtk proxy`)
when in doubt.

## Bundle discipline

`BUNDLE_AUDIT.md` documents the chunk strategy. Significant deps must be
weighed against the audit before they land — gateway routes are
code-split, but vendor weight on the initial entry is enforced.

## When in doubt

- Endpoint exists? Check `contrib-docs/admin-stage2-endpoint-manifest.md`.
- Decision history? Check `contrib-docs/stage2-master-decisions.md`.
- Stage-2 narrative? Check `contrib-docs/admin-stage2-completion.md`.
