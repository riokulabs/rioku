#!/usr/bin/env bash
# sandbox/scripts/stop.sh — Stop the Rioku sandbox environment.
# Quits screen sessions (if screen was used) and kills any background PIDs.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SANDBOX_DIR="${REPO_ROOT}/sandbox"
DATA_DIR="${SANDBOX_DIR}/.data"
PID_FILE="${DATA_DIR}/pids"

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${RED}[WARN]${NC}  $*"; }

SCREEN_SESSIONS=(rioku-daemon rioku-users rioku-products rioku-webhooks rioku-auth rioku-media)

echo ""
echo -e "${BOLD}==> Stopping sandbox${NC}"
echo ""

# --------------------------------------------------------------------------
# Step 1: Quit screen sessions (idempotent — no error if not running)
# --------------------------------------------------------------------------
screen_found=false
if command -v screen >/dev/null 2>&1; then
  for session in "${SCREEN_SESSIONS[@]}"; do
    if screen -ls 2>/dev/null | grep -q "${session}"; then
      info "Stopping screen session: ${session}"
      screen -S "${session}" -X quit 2>/dev/null || true
      success "  ${session} stopped"
      screen_found=true
    fi
  done
fi

# --------------------------------------------------------------------------
# Step 2: Kill any background PIDs from PID file (fallback / hybrid)
# --------------------------------------------------------------------------
if [[ ! -f "${PID_FILE}" ]]; then
  if [[ "${screen_found}" == "false" ]]; then
    warn "PID file not found: ${PID_FILE}"
    warn "Sandbox may not be running (or was started without this script)."
  fi
  exit 0
fi

declare -a PIDS=()
declare -a NAMES=()

while IFS=' ' read -r pid name; do
  [[ -z "${pid}" ]] && continue
  PIDS+=("${pid}")
  NAMES+=("${name}")
done < "${PID_FILE}"

last_idx=$(( ${#PIDS[@]} - 1 ))

# Send SIGTERM in reverse order (daemon first).
for (( i=last_idx; i>=0; i-- )); do
  pid="${PIDS[$i]}"
  name="${NAMES[$i]}"
  # PID 0 = screen-managed process, already handled above.
  if [[ "${pid}" == "0" ]]; then
    continue
  fi
  if kill -0 "${pid}" 2>/dev/null; then
    info "Sending SIGTERM to ${name} (pid ${pid}) ..."
    kill -TERM "${pid}" 2>/dev/null || warn "Failed to send SIGTERM to ${name} (pid ${pid})"
  else
    info "${name} (pid ${pid}) is not running"
  fi
done

# Wait 3 seconds for graceful shutdown.
sleep 3

# Force-kill survivors.
survivors=0
for (( i=last_idx; i>=0; i-- )); do
  pid="${PIDS[$i]}"
  name="${NAMES[$i]}"
  [[ "${pid}" == "0" ]] && continue
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
  for (( i=last_idx; i>=0; i-- )); do
    pid="${PIDS[$i]}"
    name="${NAMES[$i]}"
    [[ "${pid}" == "0" ]] && continue
    if kill -0 "${pid}" 2>/dev/null; then
      warn "${name} (pid ${pid}) could not be killed — check manually"
    else
      success "${name} (pid ${pid}) force-killed"
    fi
  done
fi

rm -f "${PID_FILE}"
success "PID file removed"

echo ""
echo -e "${BOLD}Sandbox stopped.${NC}"
echo ""
