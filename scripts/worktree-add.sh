#!/bin/bash
# Create a stage-2 plan worktree from origin/stage2/main.
set -euo pipefail
NAME="${NAME:-${1:-}}"
if [ -z "$NAME" ]; then
  echo "usage: make worktree-add NAME=plan-NN-slug" >&2
  exit 2
fi
[[ "$NAME" =~ ^plan-[0-9]+[a-z]?-[a-z0-9-]+$ ]] || {
  echo "invalid name: $NAME (expected plan-NN-slug or plan-NNa-slug)" >&2
  exit 2
}

BRANCH="stage2/$NAME"
DIR=".worktrees/stage2/$NAME"

if [ -e "$DIR" ]; then
  echo "worktree already exists at $DIR" >&2
  exit 1
fi

mkdir -p "$(dirname "$DIR")"
git fetch origin stage2/main
git worktree add "$DIR" -b "$BRANCH" origin/stage2/main

# Initialize per-worktree decisions-needed.md from template if present
if [ -f contrib-docs/templates/decisions-needed.md ]; then
  cp contrib-docs/templates/decisions-needed.md "$DIR/decisions-needed.md"
fi

echo "worktree ready: $DIR (branch: $BRANCH)"
echo "  cd $DIR"
echo "  make worktree-doctor"
