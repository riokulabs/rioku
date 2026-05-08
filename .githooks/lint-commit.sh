#!/usr/bin/env bash
# Validate a commit message against Rioku conventions.
# Used by both the commit-msg hook and CI.

set -euo pipefail

MSG="${1:-}"

if [ -z "$MSG" ]; then
  echo "Usage: lint-commit.sh <message|file>"
  exit 1
fi

# If argument is a file or readable special path (e.g. /dev/fd/N from
# process substitution), read the first line. Otherwise treat as a
# literal commit message string.
if [ -e "$MSG" ] && [ -r "$MSG" ]; then
  MSG=$(head -1 "$MSG")
fi

# Strip leading/trailing whitespace
MSG=$(echo "$MSG" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

# Auto-generated git messages are accepted as-is — they don't need
# to follow Conventional Commits format because the human author
# never types them. Specifically:
#   * `Merge ...`   — `git merge` default subject
#   * `Revert "..."` — `git revert` default subject (the inner
#                      reverted message is shown verbatim)
#   * `fixup! ...` / `squash! ...` — `git commit --fixup/squash`
#                                     auto-prefixed subjects
if echo "$MSG" | grep -qE '^(Merge |Revert "|fixup! |squash! )'; then
  exit 0
fi

# Reject WIP / oops / TODO commits — squash before pushing.
# Pattern: subject starts with one of these markers (case-insensitive)
# followed by either nothing, whitespace, or a colon.
LOWER_FIRST=$(echo "$MSG" | tr '[:upper:]' '[:lower:]')
case "$LOWER_FIRST" in
  wip:*|wip\ *|wip|oops:*|oops\ *|oops|"fix typo"*|todo:*|todo\ *|todo)
    echo "ERROR: Commit subject looks like work-in-progress noise (WIP/oops/TODO/'fix typo')."
    echo "       Squash it into a meaningful Conventional Commit before pushing."
    echo "  Got: $MSG"
    exit 1
    ;;
esac

# Check conventional commit format
if ! echo "$MSG" | grep -qE '^(feat|fix|docs|chore|refactor|test|ci|perf|build|revert|style)(\(.+\))?: .+'; then
  echo "ERROR: Commit message does not follow Conventional Commits format."
  echo ""
  echo "  Expected: type(scope): description"
  echo "  Types: feat, fix, docs, chore, refactor, test, ci, perf, build, revert, style"
  echo ""
  echo "  Got: $MSG"
  exit 1
fi

# Check for AI tool references (case-insensitive). Match the AI tool
# name as a word, but skip when it appears immediately after a `.` or
# `/` (path segment markers) so commit subjects that mention paths
# like `.claude/worktrees/` or `tools/anthropic/` are not flagged.
# Compound names like `claude-code` are still caught — `-` is
# treated as a word boundary, not a path separator.
if echo "$MSG" | grep -qiE '(^|[^a-zA-Z0-9./])(claude|anthropic|copilot|chatgpt|openai|gemini)\b|co-authored-by.*noreply@anthropic'; then
  echo "ERROR: Commit message contains AI tool references."
  echo "  Remove references to AI tools from commit messages."
  echo ""
  echo "  Got: $MSG"
  exit 1
fi

# Check subject line length (72 chars max for the description part)
SUBJECT_LEN=${#MSG}
if [ "$SUBJECT_LEN" -gt 100 ]; then
  echo "WARNING: Commit subject is $SUBJECT_LEN chars (recommended max: 100)."
fi
