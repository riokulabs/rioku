#!/bin/bash
# Merge open decision entries from active plan worktrees into the master list.
set -euo pipefail

MASTER="contrib-docs/stage2-master-decisions.md"
MIRROR="tmp/stage2-master-decisions.md"

if [ ! -f "$MASTER" ]; then
  echo "master decision list not found at $MASTER" >&2
  exit 1
fi

# Collect entries from each worktree's decisions-needed.md
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

found=0
for d in .worktrees/stage2/plan-*/; do
  [ -d "$d" ] || continue
  if [ -f "$d/decisions-needed.md" ]; then
    found=1
    awk '/^## Item /{flag=1} flag{print}' "$d/decisions-needed.md" >> "$TMP"
    echo "" >> "$TMP"
  fi
done

if [ "$found" -eq 0 ]; then
  echo "no worktrees under .worktrees/stage2/ — nothing to sync"
  exit 0
fi

# Run the dedup + section-aware merge
python3 scripts/decisions-merge.py "$MASTER" "$TMP" "$MASTER"

# Mirror to tmp (git-ignored — used by orchestrator scripts that need a guaranteed read path)
mkdir -p tmp
cp "$MASTER" "$MIRROR"

echo "decisions synced → $MASTER (+ $MIRROR mirror)"
