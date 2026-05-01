#!/usr/bin/env bash
# sandbox/scripts/stop.sh — Stop the Rioku sandbox environment.
# Stops all services tracked by PID files, with graceful shutdown and fallback.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SANDBOX_DIR="${REPO_ROOT}/sandbox"

# --------------------------------------------------------------------------
# Load environment config
# --------------------------------------------------------------------------
ENV_FILE="${SANDBOX_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi
: "${SANDBOX_PORT_USERS:=9001}"
: "${SANDBOX_PORT_PRODUCTS:=9002}"
: "${SANDBOX_PORT_WEBHOOKS:=9003}"
: "${SANDBOX_PORT_AUTH:=9004}"
: "${SANDBOX_PORT_MEDIA:=9005}"

# --------------------------------------------------------------------------
# Derived paths
# --------------------------------------------------------------------------
DATA_DIR="${SANDBOX_DIR}/.data"
PID_DIR="${DATA_DIR}/pids"

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

# --------------------------------------------------------------------------
# stop_service — graceful shutdown with SIGKILL fallback
# --------------------------------------------------------------------------
stop_service() {
  local name="$1"
  local pid_file="${PID_DIR}/${name}.pid"

  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi

  local pid
  pid=$(cat "$pid_file")

  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    return 0
  fi

  info "Stopping ${name} (PID ${pid})..."
  kill "$pid" 2>/dev/null || true

  # Wait up to 5s for graceful shutdown.
  local i
  for i in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done

  # Force kill if still alive.
  if kill -0 "$pid" 2>/dev/null; then
    warn "${name} did not stop gracefully, sending SIGKILL"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      warn "${name} (PID ${pid}) could not be killed — check manually"
    else
      success "${name} force-killed"
    fi
  else
    success "${name} stopped"
  fi

  rm -f "$pid_file"
}

echo ""
echo -e "${BOLD}==> Stopping sandbox${NC}"
echo ""

# --------------------------------------------------------------------------
# Step 1: Stop all services via PID files (daemon first, then apps)
# --------------------------------------------------------------------------
stop_service "daemon"
# OTLP listener (optional; only present when SANDBOX_OTLP_ENABLED was set at start time)
stop_service "otlp"
for app in media auth webhooks products users; do
  stop_service "$app"
done

# Clean up PID directory if empty.
if [[ -d "${PID_DIR}" ]]; then
  rmdir "${PID_DIR}" 2>/dev/null || true
fi

# --------------------------------------------------------------------------
# Step 2: Kill orphaned processes on known ports (fallback)
# --------------------------------------------------------------------------
SANDBOX_PORTS=("${SANDBOX_PORT_USERS}" "${SANDBOX_PORT_PRODUCTS}" "${SANDBOX_PORT_WEBHOOKS}" "${SANDBOX_PORT_AUTH}" "${SANDBOX_PORT_MEDIA}")
for port in "${SANDBOX_PORTS[@]}"; do
  pids_on_port=""
  if command -v fuser >/dev/null 2>&1; then
    pids_on_port=$(fuser "${port}/tcp" 2>/dev/null || true)
  elif command -v lsof >/dev/null 2>&1; then
    pids_on_port=$(lsof -ti ":${port}" 2>/dev/null || true)
  fi
  if [[ -n "${pids_on_port}" ]]; then
    for pid in ${pids_on_port}; do
      info "Killing orphaned process on port ${port} (pid ${pid})"
      kill -TERM "${pid}" 2>/dev/null || true
    done
  fi
done

# Brief wait for orphaned processes to exit, then force-kill survivors.
sleep 1
for port in "${SANDBOX_PORTS[@]}"; do
  pids_on_port=""
  if command -v fuser >/dev/null 2>&1; then
    pids_on_port=$(fuser "${port}/tcp" 2>/dev/null || true)
  elif command -v lsof >/dev/null 2>&1; then
    pids_on_port=$(lsof -ti ":${port}" 2>/dev/null || true)
  fi
  if [[ -n "${pids_on_port}" ]]; then
    for pid in ${pids_on_port}; do
      warn "Force-killing process on port ${port} (pid ${pid})"
      kill -KILL "${pid}" 2>/dev/null || true
    done
  fi
done

# Kill any stale Caddy processes from previous sandbox runs.
if command -v pkill >/dev/null 2>&1; then
    STALE=$(pgrep -f "caddy run.*config.*adapter" 2>/dev/null || true)
    if [[ -n "${STALE}" ]]; then
        info "Killing stale Caddy processes: ${STALE}"
        kill ${STALE} 2>/dev/null || true
        sleep 1
        kill -9 ${STALE} 2>/dev/null || true
    fi
fi

echo ""
echo -e "${BOLD}Sandbox stopped.${NC}"
echo ""
