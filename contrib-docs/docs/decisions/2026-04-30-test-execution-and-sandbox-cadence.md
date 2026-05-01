# Decision: Test Execution Model + Sandbox Refresh Cadence

**Date**: 2026-04-30
**Sprint**: Sprint 2 (stabilization), Phase 1 prerequisite
**Issue**: tracked under the Sprint 2 plan (`tmp/plans/2026-04-30-sprint-2-stabilization-and-audit.md`)
**Status**: Accepted

## Context

Sprint 1 landed enormous backend changes (PG + MySQL drivers, OTLP, two
new Caddy primitive sets — ~28 commits across 7 phases). Two operational
practices need to be locked in before Sprint 3 builds further:

1. **Where tests run.** Today no tests run in git hooks; the pre-push
   hook still runs web `pnpm typecheck` + `pnpm lint` + `pnpm format:check`
   alongside `go vet`. Push delay is ~10-25s per push. Now that we
   review every change via PR, the slow gate should be CI, not the
   developer's terminal.
2. **When the sandbox seed/smoke harness gets refreshed.** The sandbox
   has drifted before because nobody owned a refresh cadence. Sprint 3+
   feature validation depends on the sandbox being trustworthy.

## Decision

### Test execution model — three-tier contract

| Layer | Runs | Latency target | Authority |
| --- | --- | --- | --- |
| `pre-commit` | Auto-fix formatters (`gofmt`, `goimports`) on staged Go; `buf lint` on staged proto; `eslint --fix` on staged TS in `packages/web` and `packages/ui`; per-module `go vet` on touched modules; `golangci-lint` on changed files only (fast path) | < 5s typical | Advisory — feedback loop |
| `pre-push` | `go vet ./...` on `packages/daemon` + `packages/build-service` (smoke) | < 3s typical | Advisory — sanity check |
| `PR CI` | Full `go test -race` on daemon + build-service; full `store-matrix-*` (5 required + 1 optional); full `golangci-lint`; `buf lint`; `cspell`; full web suite (lint + typecheck + format + Vitest + Playwright + bundle audit + ABI audit); `test-e2e` (sandbox smoke + Playwright) | n/a | **Authoritative — blocks merge** |

**No tests run in any git hook.** This is non-negotiable. Push must be
fast enough that contributors don't bypass it.

**No web/TS pipeline checks in pre-push.** The `pnpm typecheck` /
`pnpm lint` / `pnpm format:check` chain currently in pre-push moves to
PR CI exclusively (where it already exists). Pre-commit retains the
*changed-files-only* slice (auto-fix + lint on staged TS) for fast
feedback while typing.

**CI is the source of truth.** Branch protection requires every job
listed under "PR CI" above. A green hook means nothing without a green
PR.

### Sandbox refresh cadence

The sandbox seed data, config, and smoke harness must be refreshed:

1. **At every sprint tie-off** — last commit before merging the sprint
   branch must include any sandbox updates needed for the new schema /
   API surface. The tie-off PR description must mention sandbox status
   explicitly (✅ green / ⚠️ updated / ❌ broken with follow-up issue).
2. **On any schema migration landing** — adding a migration in
   `packages/daemon/internal/store/migrations/{sqlite,postgres,mysql}/`
   triggers a sandbox seed-data review in the same PR. New tables /
   new NOT NULL columns must reflect in the seed.
3. **On any new Caddy primitive landing** — primitives shipped in the
   compiler (e.g., the request/response headers + dynamic upstreams +
   trusted_proxies work in Sprint 1 phases 7a/7b) must be exercised in
   the sandbox config so PR CI's smoke tests cover them.
4. **On demand** when a contributor flags drift — opens a tracking
   issue, fixes within the next sprint.

Cadence ownership: whoever lands the change owns the matching sandbox
update. Reviewers reject PRs that introduce schema or primitive
changes without the corresponding sandbox refresh.

## Rationale

### Why no tests in hooks

- **Developers bypass slow hooks.** A 30s pre-push trains people to
  run `git push --no-verify`. A 3s pre-push is invisible.
- **CI parallelism beats serial hooks.** PR CI runs `lint`, `proto`,
  `spell`, `test`, `test-e2e`, `web`, and 5 `store-matrix-*` jobs
  concurrently. The slowest job wins; locally everything is serial.
- **Hooks are opt-in.** `make hooks` toggles `core.hooksPath`. New
  contributors who skip setup get nothing locally — CI must be the
  gate regardless. Treat hooks as a developer-experience nicety, not
  a quality gate.

### Why pre-commit keeps changed-files lint

- Auto-fix at commit time means contributors don't think about
  `gofmt` / `goimports` / `eslint --fix` ever. Drift gets fixed
  silently; CI never has to flag it.
- Changed-files-only keeps it fast. Repo-wide lint passes belong in
  CI where parallelism is free.

### Why a sandbox cadence at all

- Per `CLAUDE.md` Development Validation: *"If the sandbox is broken,
  fix it before doing anything else."* This is policy. Without a
  cadence, "broken sandbox" means "we'll fix it eventually" → never.
- Tying refresh to schema / primitive landings means drift is caught
  at the source. Tying it to sprint tie-off catches anything that
  slipped through.

## Consequences

- **`.githooks/pre-push` shrinks** to `go vet` only. Web checks move out.
- **`.githooks/pre-commit` grows** with `goimports`, changed-files
  `golangci-lint`, and changed-files TS lint. Total time still under 5s.
- **`.golangci.yml`** gets `goimports` enabled as a linter so CI catches
  what local pre-commit might miss (e.g., contributors who skipped
  `make hooks`).
- **CI workflow `ci.yml`** is unchanged structurally; the existing
  `web` and `lint` jobs already cover what's leaving the hook.
- **Branch protection** must enforce the full required-job list:
  - `commit-lint`, `lint`, `proto`, `spell`, `test`, `test-e2e`, `web`
  - `store-matrix-sqlite`, `store-matrix-postgres-15`,
    `store-matrix-postgres-18`, `store-matrix-mysql-8-4`,
    `store-matrix-mariadb-11-4`
  - **NOT required**: `store-matrix-mariadb-11-8` (continue-on-error).
- **`CLAUDE.md`** gets a "Test execution contract" section under
  "Development Validation" so contributors know where each check runs.
- **`contrib-docs/docs/development/`** gains a `hooks.md` page with the
  table above for at-a-glance reference.
- Future addition of a second log sink, new dependency, or new test
  surface that's slow enough to warrant a hook check should revisit
  this decision rather than silently lengthen pre-push.

## Non-decisions / out of scope

- This decision does **not** change how the sandbox is built — only
  when it must be refreshed. Phase 4 of Sprint 2 covers the rebuild
  itself.
- This decision does **not** add or remove any CI job. It freezes the
  shape of what CI runs; Phase 1d / 1e adjust branch protection and
  docs to match.
- This decision does **not** mandate a particular linter rule set.
  `.golangci.yml` content stays as is unless a separate proposal
  changes it.
