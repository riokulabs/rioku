# Web Admin DX Overhaul — Design Spec

**Date:** 2026-04-08  
**Status:** Approved  
**Goal:** Modernize the web admin toolchain, fix build performance, improve sandbox DX, and add contract tests to prevent proto/frontend type drift.

---

## Problem Statement

The web admin panel build pipeline is slow and the toolchain is outdated. Iteration cycles that should take 2 seconds take 21+ seconds. Tests don't catch proto-to-frontend field name mismatches (the `occurredAt` vs `timestamp` bug class). The sandbox gives poor diagnostics when things go wrong, and random internal port assignment causes 502s after daemon restarts.

## Scope

Five workstreams in a single plan:

1. **Toolchain upgrade** — Vite 8, TypeScript 6, plugin-react 6 (Oxc), Vitest 4, happy-dom
2. **Build config fixes** — tsconfig incremental, build script cleanup, vitest environment
3. **Makefile improvements** — Smart web rebuild caching, `make sandbox-status`
4. **Proto-to-frontend contract tests** — Validate REST JSON shapes match TS types
5. **Deterministic ports + stale sandbox handling** — Predictable internal gateway port, stale detection

---

## Section 1: Toolchain Upgrade

### Version Matrix

| Package | From | To | Rationale |
|---------|------|----|-----------|
| `vite` | 6.4.2 | 8.0.7 | Rolldown bundler (5-15x faster), Oxc minifier |
| `@vitejs/plugin-react` | 4.7.0 (Babel) | 6.0.1 (Oxc) | Drops Babel, uses Vite 8 native Oxc transforms |
| `typescript` | 5.9.3 | 6.0.2 | Latest stable |
| `vitest` | 3.2.4 | 4.1.3 | Required for Vite 8 peer dependency |
| `@vitest/coverage-v8` | 3.2.4 | 4.1.3 | Must match Vitest major |
| `jsdom` | 26.1.0 | Remove | Replaced by happy-dom |
| `happy-dom` | — | 20.8.9 | 2-3x faster DOM implementation for tests |

### Compatibility Verification

- `@tailwindcss/vite@4.2.2`: peer dep `^5.2.0 || ^6 || ^7 || ^8` — compatible
- `@tanstack/router-plugin@1.167.12`: peer dep `>=7.0.0` — covers 8.x
- `@vitejs/plugin-react@6.0.1`: peer dep `^8.0.0` — Vite 8 exclusive, Oxc-based, no Babel
- Node.js minimum: 20.19+ or 22.12+ (current environment satisfies this)

### Migration Notes

- `@vitejs/plugin-react` v6 has no `babel` option — not an issue, no custom Babel plugins used
- `build.rollupOptions` renamed to `build.rolldownOptions` (not currently used, but noted)
- `manualChunks` object form removed, function form deprecated → use Rolldown `codeSplitting` (not currently used)
- Plugin-react v6 import path stays the same (`@vitejs/plugin-react`)

---

## Section 2: Build Config Fixes

### tsconfig.json

Add incremental compilation to cache TypeScript's AST analysis between builds:

```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/.cache/tsbuildinfo"
  }
}
```

Expected impact: repeat builds with no changes go from 8.3s to <1s.

### Build Script (package.json)

Change from:
```json
"build": "tsc -b && vite build"
```

To:
```json
"build": "tsc --noEmit && vite build"
```

Rationale: `tsc -b` (build mode) with `noEmit: true` in tsconfig is contradictory. `tsc --noEmit` is the correct invocation for type-checking only. Combined with `incremental: true`, this becomes nearly instant on repeat builds.

### vitest.config.ts

- Switch `environment: 'jsdom'` to `environment: 'happy-dom'`
- Update plugin import if needed for vitest + plugin-react v6 compatibility
- Evaluate whether manual mocks in `setup.ts` (matchMedia, ResizeObserver, IntersectionObserver) can be removed — happy-dom may provide these natively

### vite.config.ts

- Update `@vitejs/plugin-react` import (same path, v6 API)
- Fix resolve alias from `'@': '/src'` to `'@': resolve(__dirname, 'src')` (proper absolute path)
- No other config changes needed — `build.outDir`, `emptyOutDir`, `server.proxy` are unchanged in Vite 8

---

## Section 3: Makefile Improvements

### Smart Web Rebuild (hash-based caching)

Add a `web-build-if-changed` Makefile target:

1. Compute a hash of all web source files: `src/`, `vite.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json`
2. Compare against a sentinel file at `packages/web/build/.build-hash`
3. If hash matches: skip `npm run build` entirely
4. If hash differs or sentinel missing: run `npm run build`, write new hash to sentinel

Wire this into the build chain:
- `build-daemon` depends on `web-embed`, which depends on `web-build-if-changed` (instead of `web-build`)
- `sandbox-restart-daemon` uses `build-daemon` (which now skips web when unchanged)
- `sandbox-restart-daemon-fast` remains as the "skip web unconditionally" escape hatch

Expected impact: `make sandbox-restart-daemon` drops from ~21s to ~2s when only Go code changed.

### `make sandbox-status`

A single command that outputs a clear status table:

- Screen sessions: running/stopped for each (rioku-daemon, rioku-users, rioku-products, rioku-webhooks, rioku-auth, rioku-media)
- Ports: listening/closed for 7777 (gRPC), 7778 (REST), 8443 (traffic), 9001-9005 (upstream apps)
- Health: healthy/unhealthy/unreachable for daemon and each upstream app
- If daemon is unhealthy: show last 5 lines of `sandbox/.data/daemon.log`

Implementation: a bash script at `sandbox/scripts/status.sh` invoked by the Makefile target.

---

## Section 4: Proto-to-Frontend Contract Tests

### Approach

A Go integration test file in `packages/daemon/internal/gateway/` that:

1. Stands up the full REST gateway (same test harness as `auth_integration_test.go`)
2. Authenticates as a test user
3. Hits each REST endpoint and unmarshals the JSON response
4. Asserts that expected field names are present in the response

### Endpoints to Cover

| Endpoint | Expected Fields (top-level) |
|----------|---------------------------|
| `GET /api/v1/health` | `overall`, `store`, `caddy`, `version`, `uptime` |
| `GET /api/v1/config` | `version`, `routes`, `services`, `policies` |
| `GET /api/v1/audit` | Array of: `id`, `actor`, `entityType`, `entityId`, `operation`, `diff`, `configVersion`, `occurredAt` |
| `GET /api/v1/auth/me` | `user`, `session` |
| `GET /api/v1/keys` | Array of: `id`, `name`, `prefix`, `scopes`, `expiresAt`, `createdAt` |

### Design Principles

- Not codegen — it's a contract test. A simple map of `endpoint → []expectedFields` in the test file.
- If a proto field is renamed, this test fails before it reaches the browser.
- The field name list mirrors the frontend TypeScript types in `packages/web/src/lib/api.ts`.
- A comment in the test references the TypeScript file so maintainers know to update both.

---

## Section 5: Deterministic Ports + Stale Sandbox Handling

### Deterministic Internal Gateway Port

Change the REST internal gateway from binding `127.0.0.1:0` (random) to `127.0.0.1:7780` (deterministic default). If port 7780 is in use, auto-increment through 7781, 7782, ... up to 7789 (10 attempts).

This ensures that after a daemon restart, Caddy's config sync reconnects to the same (or predictable) address, eliminating the 502 stale-port problem.

Implementation: modify the gateway bind logic in the daemon to accept a configurable internal port with auto-increment fallback. Add `internal_port: 7780` to the config file defaults.

### Stale Sandbox Detection

**In `start.sh`:** Before starting, check if a sandbox is already running:
- Check for existing screen sessions (rioku-daemon, rioku-users, etc.)
- Check if the PID file exists and the process is alive
- If stale (sessions/PIDs exist but processes are dead): clean up automatically and proceed
- If actually running: print warning and exit with message: "Sandbox already running. Run 'make sandbox-stop' first or 'make sandbox-reset' to wipe and restart."

**In `sandbox-restart-daemon`:** Before restarting:
- Kill the old Caddy child process (currently orphaned when the daemon screen session is killed)
- The new daemon starts its own fresh Caddy child

---

## Expected Outcomes

| Metric | Before | After |
|--------|--------|-------|
| Web build (no changes) | 21.5s | ~2s (skipped) |
| Web build (with changes) | 21.5s | ~5-8s (Vite 8 + incremental tsc) |
| Vitest run | baseline | 30-50% faster (happy-dom + threads) |
| Proto/frontend type bugs | caught in browser | caught in `go test` |
| Sandbox status check | tail logs + guess | `make sandbox-status` |
| Post-restart 502s | frequent | eliminated (deterministic port) |
| Stale sandbox confusion | manual investigation | auto-detected |
