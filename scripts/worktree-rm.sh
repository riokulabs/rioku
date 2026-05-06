#!/bin/bash
# Remove a worktree. Archives decisions-needed.md before delete.
set -euo pipefail
NAME="${NAME:-${1:-}}"
if [ -z "$NAME" ]; then
  echo "usage: make worktree-rm NAME=plan-NN-slug" >&2
  exit 2
fi
DIR=".worktrees/stage2/$NAME"
if [ ! -e "$DIR" ]; then
  echo "no worktree at $DIR" >&2
  exit 1
fi

# Archive decisions-needed.md (per §13.2 sync protocol)
mkdir -p tmp/decisions-archive
if [ -f "$DIR/decisions-needed.md" ]; then
  cp "$DIR/decisions-needed.md" "tmp/decisions-archive/$NAME.md"
fi

git worktree remove "$DIR"
echo "worktree removed: $DIR"
[ -f "tmp/decisions-archive/$NAME.md" ] && echo "  decisions archived to tmp/decisions-archive/$NAME.md"
