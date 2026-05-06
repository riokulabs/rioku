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
- **Recommendation:** **keep the mock-store path as default for now**;
  the daemon-side endpoints are documented in OpenAPI so plan-12
  integration close-out can wire `VITE_USE_MOCKS=false` without
  another schema turn. Plugin-signers already use the real fetch
  pattern (`features/plugin-signers/api.ts`) — that file is the
  template the next executor follows when retiring the plugin
  mock-store.
- **Alternatives:** wire installed/marketplace to the real endpoint
  immediately, accepting the test-rewrite cost.
- **User decision:** accepted (executor decision per Plan 09 close
  scope)
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
  signer-fingerprint-without-signature (403), and unknown-signer
  rejection (403).
- **User decision:** accepted (executor decision per Plan 09 scope)
- **Resolution date / commit:** 2026-05-06 / this commit
