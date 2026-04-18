#!/usr/bin/env bash
# sandbox/scripts/restart-daemon.sh — Kill and restart just the Rioku daemon
# (does not touch upstream sandbox apps).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SANDBOX_DIR}/.." && pwd)"
DATA_DIR="${SANDBOX_DIR}/.data"

# Load env
ENV_FILE="${SANDBOX_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a; fi
: "${SANDBOX_PORT_REST:=7778}"

DAEMON_BIN="${REPO_ROOT}/bin/rioku"
DAEMON_CONFIG="${DATA_DIR}/rioku.yaml"
PID_FILE="${DATA_DIR}/pids/daemon.pid"
LOG_FILE="${DATA_DIR}/logs/daemon.log"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# Stop existing daemon
if [[ -f "$PID_FILE" ]]; then
  pid=$(cat "$PID_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    echo -e "${CYAN}[INFO]${NC} Stopping daemon (PID ${pid})..."
    kill "$pid" 2>/dev/null || true
    for i in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$PID_FILE"
fi

# Kill stale Caddy processes
pkill -f "caddy run.*config.*adapter" 2>/dev/null || true
sleep 0.5

# Restart daemon
echo -e "${CYAN}[INFO]${NC} Starting daemon..."
mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$PID_FILE")"
"$DAEMON_BIN" start --config-file "$DAEMON_CONFIG" > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Quick health check
for i in $(seq 1 15); do
  if curl -sf "http://localhost:${SANDBOX_PORT_REST}/api/v1/health" >/dev/null 2>&1; then
    echo -e "${GREEN}[OK]${NC}   Daemon restarted and healthy"
    exit 0
  fi
  sleep 1
done

echo -e "${RED}[FAIL]${NC} Daemon not healthy after 15s. Check: make sandbox-logs-daemon"
exit 1
