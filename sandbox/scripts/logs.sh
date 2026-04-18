#!/usr/bin/env bash
# sandbox/scripts/logs.sh — Tail sandbox service log files.
# Usage:
#   logs.sh            — color-coded multiplexed tail of all services
#   logs.sh <service>  — tail a single service (e.g., logs.sh daemon)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA_DIR="${SANDBOX_DIR}/.data"
LOG_DIR="${DATA_DIR}/logs"

if [[ ! -d "$LOG_DIR" ]]; then
  echo "No log directory found. Is the sandbox running?"
  exit 1
fi

# Specific service filter
if [[ $# -gt 0 ]]; then
  log_file="${LOG_DIR}/${1}.log"
  if [[ -f "$log_file" ]]; then
    tail -f "$log_file"
  else
    echo "No log file for service '${1}'. Available:"
    for f in "${LOG_DIR}"/*.log; do
      [[ -f "$f" ]] && basename "$f" .log
    done
    exit 1
  fi
  exit 0
fi

# All services — color-coded
tail -f "${LOG_DIR}"/*.log 2>/dev/null | awk '
  /==> .*daemon.log/        { prefix="\033[1;36m[daemon]     \033[0m"; next }
  /==> .*users.log/         { prefix="\033[1;32m[users]      \033[0m"; next }
  /==> .*products.log/      { prefix="\033[1;33m[products]   \033[0m"; next }
  /==> .*webhooks.log/      { prefix="\033[1;35m[webhooks]   \033[0m"; next }
  /==> .*auth.log/          { prefix="\033[1;34m[auth]       \033[0m"; next }
  /==> .*media.log/         { prefix="\033[1;31m[media]      \033[0m"; next }
  { print prefix $0 }
'
