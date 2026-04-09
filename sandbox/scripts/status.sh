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
DATA_DIR="${REPO_ROOT}/sandbox/.data"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
check_screen() {
  local session="$1"
  if command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -q "${session}"; then
    echo -e "${GREEN}running${NC}"
  else
    echo -e "${RED}stopped${NC}"
  fi
}

check_port() {
  local port="$1"
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    echo -e "${GREEN}listening${NC}"
  else
    echo -e "${RED}closed${NC}"
  fi
}

check_health() {
  local url="$1"
  local resp
  resp=$(curl -sf --max-time 2 "${url}" 2>/dev/null) && echo -e "${GREEN}healthy${NC}" || echo -e "${RED}unreachable${NC}"
}

# --------------------------------------------------------------------------
# Status table
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=== Rioku Sandbox Status ===${NC}"
echo ""

printf "  ${CYAN}%-20s %-12s %-12s %-15s${NC}\n" "Component" "Screen" "Port" "Health"
echo "  ────────────────────────────────────────────────────────────"
printf "  %-20s %-12b %-12b %-15b\n" "daemon (REST)"    "$(check_screen rioku-daemon)"  "$(check_port 7778)" "$(check_health http://localhost:7778/api/v1/health)"
printf "  %-20s %-12b %-12b %-15b\n" "daemon (gRPC)"    ""                               "$(check_port 7777)" ""
printf "  %-20s %-12b %-12b %-15b\n" "traffic (Caddy)"  ""                               "$(check_port 8443)" ""
printf "  %-20s %-12b %-12b %-15b\n" "users"            "$(check_screen rioku-users)"    "$(check_port 9001)" "$(check_health http://localhost:9001/health)"
printf "  %-20s %-12b %-12b %-15b\n" "products"         "$(check_screen rioku-products)" "$(check_port 9002)" "$(check_health http://localhost:9002/health)"
printf "  %-20s %-12b %-12b %-15b\n" "webhooks"         "$(check_screen rioku-webhooks)" "$(check_port 9003)" "$(check_health http://localhost:9003/health)"
printf "  %-20s %-12b %-12b %-15b\n" "auth"             "$(check_screen rioku-auth)"     "$(check_port 9004)" "$(check_health http://localhost:9004/health)"
printf "  %-20s %-12b %-12b %-15b\n" "media"            "$(check_screen rioku-media)"    "$(check_port 9005)" "$(check_health http://localhost:9005/health)"

echo ""

# --------------------------------------------------------------------------
# Daemon log tail (if unhealthy)
# --------------------------------------------------------------------------
if ! curl -sf --max-time 2 http://localhost:7778/api/v1/health >/dev/null 2>&1; then
  if [[ -f "${DATA_DIR}/daemon.log" ]]; then
    echo -e "${YELLOW}Daemon is not healthy. Last 10 log lines:${NC}"
    echo ""
    tail -10 "${DATA_DIR}/daemon.log" | sed 's/^/    /'
    echo ""
  fi
fi
