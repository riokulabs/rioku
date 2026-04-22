# @rioku/web

Rioku admin panel. **Stage 1: UI/UX/IA mock** — runs standalone on the in-browser mock store, no daemon required.

## Quick start

```bash
pnpm install      # uses pnpm ≥10 (enforced via engines + packageManager)
pnpm dev          # http://localhost:5173
pnpm test         # Vitest unit + component
pnpm test:e2e     # Playwright smoke
pnpm lint         # ESLint
pnpm build        # production build (embedded into daemon via go:embed in Plan 9)
```

Corepack users: `corepack enable` picks up the `packageManager` pin in `package.json`.

## Spec

See `tmp/specs/2026-04-18-admin-mantine-design.md` for the full design. This package implements Plan 1 (foundation quad).

## Stage-1 contract

- **No daemon.** `VITE_USE_MOCKS=true` is the default; mutations write to the in-browser Zustand store.
- **No telemetry.** No external requests, ever. Enforced by `e2e/smoke/no-telemetry.spec.ts`.
- **No real CEL evaluation.** `cel-js` parses CEL for syntax hints; the (mock) daemon is the authoritative evaluator.
- **No real plugin rebuilds.** Dev-mode sideload via `?plugin=./path/plugin.mjs` is available; OCI/tarball paths are fake-functional in stage 1.
