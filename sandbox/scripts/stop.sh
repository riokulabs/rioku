#!/usr/bin/env bash
# sandbox/scripts/stop.sh — Stop the Rioku sandbox environment.
# Reads PIDs from .data/pids, sends SIGTERM in reverse order (daemon first),
# waits for graceful shutdown, then force-kills any survivors.
set -euo pipefail

# --------------------------------------------------------------------------
# ANSI colors
# --------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SANDBOX_DIR="${REPO_ROOT}/sandbox"
DATA_DIR="${SANDBOX_DIR}/.data"
PID_FILE="${DATA_DIR}/pids"

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${RED}[WARN]${NC}  $*"; }

# --------------------------------------------------------------------------
# Read PIDs from file
# --------------------------------------------------------------------------
if [[ ! -f "${PID_FILE}" ]]; then
  warn "PID file not found: ${PID_FILE}"
  warn "Sandbox may not be running (or was started without this script)."
  exit 0
fi

# Build arrays in forward order (apps first, daemon last as written by start.sh).
# Reverse for shutdown: daemon gets SIGTERM first so it can flush state cleanly.
declare -a PIDS=()
declare -a NAMES=()

while IFS=' ' read -r pid name; do
  [[ -z "${pid}" ]] && continue
  PIDS+=("${pid}")
  NAMES+=("${name}")
done < "${PID_FILE}"

if [[ ${#PIDS[@]} -eq 0 ]]; then
  warn "No PIDs found in ${PID_FILE}."
  rm -f "${PID_FILE}"
  exit 0
fi

echo ""
echo -e "${BOLD}==> Stopping sandbox (${#PIDS[@]} processes)${NC}"
echo ""

# --------------------------------------------------------------------------
# Step 1: SIGTERM in reverse order (daemon first, then apps)
# --------------------------------------------------------------------------
last_idx=$(( ${#PIDS[@]} - 1 ))
for (( i=last_idx; i>=0; i-- )); do
  pid="${PIDS[$i]}"
  name="${NAMES[$i]}"
  if kill -0 "${pid}" 2>/dev/null; then
    info "Sending SIGTERM to ${name} (pid ${pid}) ..."
    kill -TERM "${pid}" 2>/dev/null || warn "Failed to send SIGTERM to ${name} (pid ${pid})"
  else
    info "${name} (pid ${pid}) is not running"
  fi
done

# --------------------------------------------------------------------------
# Step 2: Wait up to 3 seconds for graceful shutdown
# --------------------------------------------------------------------------
info "Waiting 3s for graceful shutdown ..."
sleep 3

# --------------------------------------------------------------------------
# Step 3: Force-kill any survivors with SIGKILL
# --------------------------------------------------------------------------
survivors=0
for (( i=last_idx; i>=0; i-- )); do
  pid="${PIDS[$i]}"
  name="${NAMES[$i]}"
  if kill -0 "${pid}" 2>/dev/null; then
    warn "${name} (pid ${pid}) still alive — sending SIGKILL"
    kill -KILL "${pid}" 2>/dev/null || true
    (( survivors++ )) || true
  else
    success "${name} (pid ${pid}) stopped"
  fi
done

if (( survivors > 0 )); then
  sleep 1
  # Confirm SIGKILL landed.
  for (( i=last_idx; i>=0; i-- )); do
    pid="${PIDS[$i]}"
    name="${NAMES[$i]}"
    if kill -0 "${pid}" 2>/dev/null; then
      warn "${name} (pid ${pid}) could not be killed — check manually"
    else
      success "${name} (pid ${pid}) force-killed"
    fi
  done
fi

# --------------------------------------------------------------------------
# Step 4: Remove PID file
# --------------------------------------------------------------------------
rm -f "${PID_FILE}"
success "PID file removed"

echo ""
echo -e "${BOLD}Sandbox stopped.${NC}"
echo ""
