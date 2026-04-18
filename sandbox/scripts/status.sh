#!/usr/bin/env bash
# sandbox/scripts/status.sh — Show the status of all sandbox components.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
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
: "${SANDBOX_PORT_REST:=7778}"
: "${SANDBOX_PORT_GRPC:=7777}"
: "${SANDBOX_PORT_TRAFFIC:=8443}"
: "${SANDBOX_PORT_USERS:=9001}"
: "${SANDBOX_PORT_PRODUCTS:=9002}"
: "${SANDBOX_PORT_WEBHOOKS:=9003}"
: "${SANDBOX_PORT_AUTH:=9004}"
: "${SANDBOX_PORT_MEDIA:=9005}"

# --------------------------------------------------------------------------
# Derived paths
# --------------------------------------------------------------------------
DATA_DIR="${SANDBOX_DIR}/.data"
LOG_DIR="${DATA_DIR}/logs"
PID_DIR="${DATA_DIR}/pids"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

check_health() {
  local url="$1"
  curl -sf --max-time 2 "${url}" >/dev/null 2>&1 && echo -e "${GREEN}healthy${NC}" || echo -e "${RED}unreachable${NC}"
}

# Pad a colored string to a visible width.
padcol() {
  local str="$1" width="$2"
  local plain
  plain=$(echo -e "$str" | sed 's/\x1b\[[0-9;]*m//g')
  local pad=$(( width - ${#plain} ))
  echo -en "$str"
  (( pad > 0 )) && printf "%${pad}s" ""
  return 0
}

# Check service status via PID file and optional health endpoint.
check_service() {
  local name="$1"
  local port="$2"
  local health_path="${3:-}"
  local pid_file="${PID_DIR}/${name}.pid"
  local health_url="http://localhost:${port}${health_path}"

  local status_col health_col pid_text

  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      pid_text="PID ${pid}"
      if [[ -n "$health_path" ]]; then
        if curl -sf --max-time 2 "${health_url}" >/dev/null 2>&1; then
          status_col="${GREEN}running${NC}"
          health_col="${GREEN}healthy${NC}"
        else
          status_col="${YELLOW}running${NC}"
          health_col="${YELLOW}starting${NC}"
        fi
      else
        status_col="${GREEN}running${NC}"
        health_col=""
      fi
    else
      pid_text="stale PID ${pid}"
      status_col="${RED}dead${NC}"
      health_col="${RED}unreachable${NC}"
    fi
  else
    pid_text=""
    status_col="${RED}stopped${NC}"
    health_col=""
  fi

  # Print row
  echo -n "  "
  padcol "$name" 18
  padcol ":${port}" 10
  padcol "$status_col" 14
  padcol "$pid_text" 14
  echo -e "$health_col"
}

# --------------------------------------------------------------------------
# Status table
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=== Rioku Sandbox Status ===${NC}"
echo ""

echo -n "  "
padcol "${CYAN}Service${NC}" 18
padcol "${CYAN}Port${NC}" 10
padcol "${CYAN}Status${NC}" 14
padcol "${CYAN}PID${NC}" 14
echo -e "${CYAN}Health${NC}"
echo "  ──────────────────────────────────────────────────────────────────"

check_service "daemon"   "${SANDBOX_PORT_REST}"     "/api/v1/health"
check_service "users"    "${SANDBOX_PORT_USERS}"    "/health"
check_service "products" "${SANDBOX_PORT_PRODUCTS}"  "/health"
check_service "webhooks" "${SANDBOX_PORT_WEBHOOKS}"  "/health"
check_service "auth"     "${SANDBOX_PORT_AUTH}"      "/health"
check_service "media"    "${SANDBOX_PORT_MEDIA}"     "/health"

echo ""

# --------------------------------------------------------------------------
# Daemon log tail (if unhealthy)
# --------------------------------------------------------------------------
if ! curl -sf --max-time 2 "http://localhost:${SANDBOX_PORT_REST}/api/v1/health" >/dev/null 2>&1; then
  if [[ -f "${LOG_DIR}/daemon.log" ]]; then
    echo -e "${YELLOW}Daemon is not healthy. Last 10 log lines:${NC}"
    echo ""
    tail -10 "${LOG_DIR}/daemon.log" | sed 's/^/    /'
    echo ""
  fi
fi
