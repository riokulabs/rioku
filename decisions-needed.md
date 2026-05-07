# Decisions needed (worktree) — Plan 09 plugins

## Item 09-T4 — Plugin entity CRUD wiring

- **Status:** resolved
- **Filed by:** plan-09-plugins (stage2/plan-09-plugins), 2026-05-06
- **Category:** scope-question
- **What:** Whether to retire the mock-store-backed plugin selectors
  (`installed/api.ts`, `marketplace/api.ts`, install-progress streamer)
  in favour of generated TanStack Query hooks against the new daemon
  endpoints.
- **Found in:** `packages/web/src/features/plugins/**`
- **Why it matters:** the mock-store path drives ~80 frontend tests
  (install-approval, install-progress, marketplace, installed list,
  detail). A wholesale rewrite would re-baseline most of plan 06's
  test coverage in a single sub-PR.
- **Recommendation / Resolution:** **mock-store retired** in this
  pass; `installed/api.ts` and `marketplace/api.ts` now call the real
  daemon endpoints via `customFetch`, install-progress streams from
  a real SSE endpoint, the install-from-marketplace mutation hits the
  real POST, and the install/marketplace/installed/detail tests are
  rewritten on top of MSW. Plugin-signers had already been retired in
  the earlier pass (`features/plugin-signers/api.ts`).
- **Alternatives considered:** keep mock-store as default and wire
  later in plan-12. Rejected per audit directive: components must
  call real endpoints in this plan.
- **User decision:** accepted (executor decision per audit directive)
- **Resolution date / commit:** 2026-05-06 / this commit

## Item 09-T5 — Sideload daemon endpoint

- **Status:** resolved
- **Filed by:** plan-09-plugins (stage2/plan-09-plugins), 2026-05-06
- **Category:** missing-endpoint
- **What:** The `POST /api/v1/t/{tenant}/plugins/sideload` endpoint
  was a 501 stub.
- **Recommendation / Resolution:** replaced with a real handler that
  parses multipart, validates the manifest with `plugins.ValidateManifest`,
  optionally verifies signer trust against the tenant's plugin-signers
  via the `Signer-Fingerprint` header, stages the artifact under
  `<DataDir>/plugins/<tenant>/<plugin-id>/`, and inserts the plugin
  row.
- **Security model:**
  - The registrar enforces `plugin:install`.
  - When `Signer-Fingerprint` is set, the daemon requires a
    `signature` part and refuses unknown or non-`verified` signers.
    `cosignVerified=true` is recorded only when the signer row is
    `verified`. Cryptographic verification of the signature blob
    against the archive is delegated to the build-service trust
    ladder (#146); this stage-2 implementation captures the
    fingerprint and stages the blob.
  - When `Signer-Fingerprint` is absent, the artifact is stored
    unverified (`cosignVerified=false`). Tenants that disallow
    unsigned sideload do so via tenant policy, which is out of
    scope here.
- **Build-state mapping:** the existing CHECK constraint allows
  `stable|building|failed`. Native-arch sideloads land at `stable`
  with response `status: "ready"`; cross-arch (manifest `arch` !=
  `runtime.GOARCH`) lands at `building` with response
  `status: "pending-build"`. Adding new constraint values is a
  schema migration tracked by #142.
- **Tests:** `packages/daemon/internal/gateway/sideload_routes_test.go`
  covers happy path, invalid manifest, non-multipart rejection,
  signer-fingerprint-without-signature (403), unknown-signer
  rejection (403), dev-mode-disabled returns 404, dev-mode-enabled
  returns 201, and capabilities endpoint reports the flag.
- **User decision:** accepted (executor decision per Plan 09 scope)
- **Resolution date / commit:** 2026-05-06 / this commit

## Item 09-T6 — Sideload dev-mode gate

- **Status:** resolved
- **Filed by:** plan-09-plugins (stage2/plan-09-plugins), 2026-05-06
- **Category:** security-regression
- **What:** Sideload was reachable in production with only the
  `plugin:install` permission, leaking the endpoint's existence and
  exposing the daemon to drive-by attempts.
- **Resolution:**
  - Added `daemon.sideload_enabled` config field + `RIOKU_SIDELOAD_ENABLED`
    env var (`Config.SideloadEnabled()` reports the union); default false.
  - `handlePluginSideload` now returns 404 (not 403) when the flag is
    off, so the endpoint is indistinguishable from one that doesn't
    exist.
  - Added `GET /api/v1/capabilities` returning the feature-flag
    snapshot. The admin panel reads it via `useDaemonCapabilities()`
    and hides the sideload form + nav surface when disabled.
- **User decision:** accepted (executor decision per audit directive)
- **Resolution date / commit:** 2026-05-06 / this commit

## Item 09-T7 — Permission registry hookup

- **Status:** resolved
- **Filed by:** plan-09-plugins (stage2/plan-09-plugins), 2026-05-06
- **Category:** missing-implementation
- **What:** `rbac_routes.go:385` carried a TODO for the
  `permissionRegistry.Register` interface; plugin manifests with
  custom permissions had no way to register them with the daemon
  catalog so role grants could target them.
- **Resolution:**
  - New `internal/plugins.Register / Unregister` package functions.
  - New `tx.RegisterPluginPermissions / UnregisterPluginPermissions`
    Tx methods on the store driver, implemented for sqlite, postgres,
    mysql.
  - Sideload now invokes `RegisterPluginPermissions` in the same Tx
    as the plugin row insert (atomic). Uninstall invokes
    `UnregisterPluginPermissions` (atomic with `DeletePlugin`).
  - Built-in conflicts surface as `ErrPermissionConflict → 409`. Per
    migration 000049's source-handling rule, plugin-sourced rows are
    deleted outright on uninstall.
- **Tests:** `internal/plugins/permission_registry_test.go` covers
  register/unregister lifecycle, idempotent re-register, built-in
  conflict, invalid id, and resource:action parsing.
- **User decision:** accepted (executor decision per audit directive)
- **Resolution date / commit:** 2026-05-06 / this commit
