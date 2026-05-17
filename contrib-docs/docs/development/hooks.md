# Git hooks + CI gating

The Rioku monorepo uses a three-tier check model. Hooks are local
developer-experience helpers; **PR CI is the authoritative gate** that
blocks merge.

## At a glance

| Layer | Runs | Latency | Authoritative? |
| --- | --- | --- | --- |
| `pre-commit` | gofmt + goimports auto-fix on staged Go; per-touched-module `go vet`; `buf lint` on staged proto; `eslint --fix` on staged TS in `packages/web` and `packages/ui` | < 5s typical | No — advisory |
| `pre-push` | gofmt + goimports drift check on all Go in `packages/daemon` + `packages/build-service`; `go vet ./...` smoke; prettier format check on `packages/web` | < 8s typical | No — advisory |
| **PR CI** | Full `go test -race`, `store-matrix-*` (sqlite + postgres-15/18 + mysql-8.4 + mariadb-11.4), full `golangci-lint`, `buf lint`, `cspell`, full web suite (lint + typecheck + format + Vitest + Playwright + bundle/ABI audits), `test-e2e` (sandbox smoke + Playwright), gofmt/goimports drift check | varies | **Yes — blocks merge** |

## Setup

```bash
make hooks          # one-time: enable .githooks/ via core.hooksPath
make setup          # also installs goimports, golangci-lint, buf, etc. via mise
```

Hooks are **opt-in**. Contributors who skip `make hooks` get nothing
locally; PR CI catches everything regardless.

## What runs in each hook

### `pre-commit` (`.githooks/pre-commit`)

On staged `.go` files:

- `gofmt -w` — auto-fix and re-stage.
- `goimports -w` — auto-fix imports + re-stage. Skipped if `goimports` isn't on `$PATH`.
- `go vet ./...` — per touched module, workspace-aware via `go.work`.

On staged `.proto` files:

- `buf lint` — runs in `packages/proto`. Skipped if `buf` isn't installed.

On staged `.ts/.tsx/.js/.jsx/.mjs/.cjs` files in `packages/web` or `packages/ui`:

- `pnpm exec eslint --fix --max-warnings=0` on changed files only.
- Re-stages anything `--fix` modified. Skipped if `pnpm` or that
  package's `node_modules/eslint` isn't installed.

### `pre-push` (`.githooks/pre-push`)

On all Go files in `packages/daemon` and `packages/build-service`:

- `gofmt -l .` — reports unformatted files and blocks the push. Fix with `gofmt -w <file>`.
- `goimports -l .` — reports import drift and blocks the push. Skipped if `goimports` isn't on `$PATH`.
- `go vet ./...` — quick vet smoke.

On `packages/web` (when `node_modules` and `pnpm` are present):

- `pnpm exec prettier --check .` — reports formatting issues and blocks the push. Fix with `pnpm exec prettier --write .`.

**No tests, no `pnpm typecheck`, no Playwright.** All of those are PR CI's job.

### `commit-msg` (`.githooks/commit-msg` → `lint-commit.sh`)

- Conventional Commits format check (`feat|fix|docs|chore|refactor|test|ci|perf|build|revert`).
- Rejects AI tool references (claude, anthropic, copilot, chatgpt, openai, gemini, `Co-Authored-By .*noreply@anthropic`).
- Soft warning if subject > 100 chars.

## CI gates (`.github/workflows/`)

### `ci.yml`

| Job | Triggers | What it runs |
| --- | --- | --- |
| `commit-lint` | PR only | `lint-commit.sh` on every commit between `base..head` |
| `lint` | PR + push to develop | gofmt + goimports drift check; `golangci-lint run` on daemon (`-tags noadmin`) + build-service |
| `proto` | PR + push to develop | `buf lint` on `packages/proto` |
| `spell` | PR + push to develop | `cspell` over `**/*.{go,md,proto,yaml,yml}` |
| `test` | PR + push to develop | `go test -tags noadmin -race -count=1 -timeout=300s` on daemon + build-service. `-short` on push, full on PR |
| `test-e2e` | PR + push to develop | Boots `make sandbox`, runs `make sandbox-test-smoke`, full Playwright |
| `web` | PR + push to develop | `pnpm lint` + `typecheck` + `format:check` + `test` + Playwright + `build` + bundle + ABI |

### `store-matrix.yml`

Triggers only when `packages/daemon/internal/store/**` or the workflow
itself changes (path-filtered).

| Job | Required? |
| --- | --- |
| `store-matrix-sqlite` | **Yes** |
| `store-matrix-postgres-15` | **Yes** |
| `store-matrix-postgres-18` | **Yes** |
| `store-matrix-mysql-8-4` | **Yes** |
| `store-matrix-mariadb-11-4` | **Yes** |
| `store-matrix-mariadb-11-8` | Optional (`continue-on-error: true`) |

## Branch protection (recommended config)

Branch protection lives in GitHub repo settings, not in this repo. The
recommended required-status-checks list for `develop` and `main`:

```text
commit-lint
lint
proto
spell
test
test-e2e
web
store-matrix-sqlite
store-matrix-postgres-15
store-matrix-postgres-18
store-matrix-mysql-8-4
store-matrix-mariadb-11-4
```

`store-matrix-mariadb-11-8` is intentionally **not required** — it runs
with `continue-on-error: true` for early-signal coverage of a non-LTS
MariaDB version.

To apply via `gh`:

```bash
gh api -X PUT repos/riokulabs/rioku/branches/develop/protection \
  -f required_status_checks.strict=true \
  -f required_status_checks.contexts[]=commit-lint \
  -f required_status_checks.contexts[]=lint \
  -f required_status_checks.contexts[]=proto \
  -f required_status_checks.contexts[]=spell \
  -f required_status_checks.contexts[]=test \
  -f required_status_checks.contexts[]=test-e2e \
  -f required_status_checks.contexts[]=web \
  -f required_status_checks.contexts[]=store-matrix-sqlite \
  -f required_status_checks.contexts[]=store-matrix-postgres-15 \
  -f required_status_checks.contexts[]=store-matrix-postgres-18 \
  -f required_status_checks.contexts[]=store-matrix-mysql-8-4 \
  -f required_status_checks.contexts[]=store-matrix-mariadb-11-4 \
  -F enforce_admins=null \
  -F required_pull_request_reviews=null \
  -F restrictions=null
```

## Bypassing hooks (don't unless you know why)

`git commit --no-verify` skips `pre-commit` + `commit-msg`.
`git push --no-verify` skips `pre-push`.

PR CI **cannot be bypassed** once branch protection is set.

## Decision rationale

Why no tests in hooks, why this contract: see
`contrib-docs/docs/decisions/2026-04-30-test-execution-and-sandbox-cadence.md`.
