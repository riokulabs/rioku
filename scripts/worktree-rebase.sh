#!/bin/bash
# Rebase every open stage-2 plan worktree onto origin/stage2/main.
set -euo pipefail

git fetch origin stage2/main

found=0
for d in .worktrees/stage2/plan-*/; do
  [ -d "$d" ] || continue
  found=1
  echo "==> $d"
  (cd "$d" && git fetch origin stage2/main && git rebase origin/stage2/main) || {
    echo "REBASE FAILED in $d — resolve manually" >&2
    exit 1
  }
done

if [ "$found" -eq 0 ]; then
  echo "no plan worktrees under .worktrees/stage2/"
  exit 0
fi

echo "all plan worktrees rebased onto origin/stage2/main"
