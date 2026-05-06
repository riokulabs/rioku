#!/bin/bash
# Verify the current worktree is healthy before claiming a plan done.
# Runs: branch check, clean tree, web-types freshness, web lint+typecheck+tests,
# go vet, daemon tests for touched packages, cspell on touched markdown,
# open decision-list count.
set -uo pipefail

fail=0

echo "== worktree-doctor =="

# 1. Branch matches directory name (heuristic: dir basename should suffix the branch)
DIRNAME=$(basename "$(pwd)")
ACTUAL=$(git rev-parse --abbrev-ref HEAD)
case "$ACTUAL" in
  stage2/*"$DIRNAME"*|*"$DIRNAME"*)
    echo "  ✓ branch ok ($ACTUAL)"
    ;;
  *)
    # Don't hard-fail — branch naming may differ; just warn
    echo "  ⚠ branch name doesn't match directory ($ACTUAL vs $DIRNAME) — may be intentional"
    ;;
esac

# 2. No uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "  ✗ uncommitted changes:"
  git status --short
  fail=1
else
  echo "  ✓ clean working tree"
fi

# 3. web-types fresh (if codegen exists in this branch)
if [ -d packages/web/src/api/generated ] && command -v make >/dev/null; then
  if make web-types >/dev/null 2>&1; then
    if [ -n "$(git status --porcelain packages/web/src/api/generated)" ]; then
      echo "  ✗ generated client out of date — run 'make web-types' and commit"
      fail=1
    else
      echo "  ✓ web-types fresh"
    fi
  fi
fi

# 4. Web lint
if [ -f packages/web/package.json ]; then
  if (cd packages/web && pnpm lint >/dev/null 2>&1); then
    echo "  ✓ web eslint clean"
  else
    echo "  ✗ web eslint failures"
    (cd packages/web && pnpm lint 2>&1 | tail -10)
    fail=1
  fi

  # 5. Web typecheck
  if (cd packages/web && pnpm typecheck >/dev/null 2>&1); then
    echo "  ✓ web tsc clean"
  else
    echo "  ✗ web tsc errors"
    fail=1
  fi
fi

# 6. Daemon vet (full module — fast)
if [ -f packages/daemon/go.mod ]; then
  if go vet ./packages/daemon/... 2>/dev/null; then
    echo "  ✓ go vet clean"
  else
    echo "  ✗ go vet errors"
    fail=1
  fi
fi

# 7. golangci-lint if available
if command -v golangci-lint >/dev/null 2>&1 && [ -f packages/daemon/go.mod ]; then
  if (cd packages/daemon && golangci-lint run --tags=noadmin ./... 2>/dev/null); then
    echo "  ✓ golangci-lint clean"
  fi
fi

# 8. Web tests
if [ -f packages/web/package.json ]; then
  if (cd packages/web && pnpm test >/dev/null 2>&1); then
    echo "  ✓ web tests pass"
  else
    echo "  ✗ web tests failing"
    fail=1
  fi
fi

# 9. Daemon tests if any daemon files were touched
TOUCHED=$(git diff --name-only origin/stage2/main..HEAD 2>/dev/null | grep '^packages/daemon/' | head -3 || true)
if [ -n "$TOUCHED" ]; then
  if go test -race -tags noadmin -timeout=300s ./packages/daemon/... >/dev/null 2>&1; then
    echo "  ✓ daemon tests pass"
  else
    echo "  ✗ daemon tests failing or timed out"
    fail=1
  fi
fi

# 10. cspell on touched markdown
TOUCHED_MD=$(git diff --name-only origin/stage2/main..HEAD 2>/dev/null | grep '\.md$' || true)
if [ -n "$TOUCHED_MD" ] && command -v pnpm >/dev/null 2>&1 && [ -f packages/web/package.json ]; then
  if (cd packages/web && pnpm exec cspell $(echo "$TOUCHED_MD" | sed 's|^|../../|g') >/dev/null 2>&1); then
    echo "  ✓ cspell clean on touched .md"
  fi
fi

# 11. Open decision-list entries (warning only)
if [ -f decisions-needed.md ]; then
  open=$(grep -c '^- \*\*Status:\*\* open' decisions-needed.md 2>/dev/null || true)
  open=${open:-0}
  if [ "$open" -gt 0 ]; then
    echo "  ⚠ $open open decision-list entries — user input needed"
  fi
fi

if [ $fail -eq 0 ]; then
  echo "== ALL GREEN =="
  exit 0
else
  echo "== DOCTOR FOUND ISSUES — fix before claiming plan done =="
  exit 1
fi
