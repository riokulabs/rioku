#!/usr/bin/env bash
# sandbox/scripts/start.sh — Start the Rioku sandbox environment.
# Builds all binaries, launches all processes (via screen if available),
# seeds config, and seeds test users.
set -euo pipefail

# --------------------------------------------------------------------------
# ANSI colors
# --------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SANDBOX_DIR="${REPO_ROOT}/sandbox"
DATA_DIR="${SANDBOX_DIR}/.data"
BIN_DIR="${DATA_DIR}/bin"
PID_FILE="${DATA_DIR}/pids"
DAEMON_BIN="${REPO_ROOT}/bin/rioku"
DAEMON_CONFIG="${DATA_DIR}/rioku.yaml"
SEED_FILE="${SANDBOX_DIR}/config/seed.json"
API_KEYS_FILE="${SANDBOX_DIR}/config/api-keys.json"
REST_ADDR="localhost:7778"
REST_BASE="http://${REST_ADDR}"
COOKIE_JAR="${DATA_DIR}/root-cookies.txt"

# --------------------------------------------------------------------------
# Detect screen availability
# --------------------------------------------------------------------------
USE_SCREEN=false
if command -v screen >/dev/null 2>&1 && screen -dmS rioku-test-screen true 2>/dev/null && screen -ls 2>/dev/null | grep -q rioku-test-screen; then
  screen -S rioku-test-screen -X quit 2>/dev/null || true
  USE_SCREEN=true
elif command -v screen >/dev/null 2>&1; then
  echo -e "${YELLOW}[WARN]${NC}  screen found but cannot create sessions (CI?) — using background processes."
else
  echo -e "${YELLOW}[WARN]${NC}  screen not found — using background processes."
  echo -e "         Install screen for a better sandbox experience:"
  echo -e "           apt install screen   (Debian/Ubuntu)"
  echo -e "           dnf install screen   (Fedora/RHEL)"
  echo -e "           brew install screen  (macOS)"
  echo ""
fi

# --------------------------------------------------------------------------
# Trap ERR — cleanup on failure
# --------------------------------------------------------------------------
cleanup_on_error() {
  echo -e "\n${RED}[ERROR]${NC} Start failed. Cleaning up..."
  if [[ "${USE_SCREEN}" == "true" ]]; then
    for session in rioku-daemon rioku-users rioku-products rioku-webhooks rioku-auth rioku-media; do
      screen -S "${session}" -X quit 2>/dev/null || true
    done
  fi
  if [[ -f "${PID_FILE}" ]]; then
    while IFS=' ' read -r pid name; do
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
        echo -e "  ${RED}killing${NC} ${name} (pid ${pid})"
        kill "${pid}" 2>/dev/null || true
      fi
    done < "${PID_FILE}"
    rm -f "${PID_FILE}"
  fi
  rm -f "${COOKIE_JAR}"
  exit 1
}
trap cleanup_on_error ERR

# --------------------------------------------------------------------------
# Pre-flight: check for existing sandbox
# --------------------------------------------------------------------------
RUNNING_SESSIONS=()
if command -v screen >/dev/null 2>&1; then
  for session in rioku-daemon rioku-users rioku-products rioku-webhooks rioku-auth rioku-media; do
    if screen -ls 2>/dev/null | grep -q "${session}"; then
      RUNNING_SESSIONS+=("${session}")
    fi
  done
fi

if (( ${#RUNNING_SESSIONS[@]} > 0 )); then
  # Check if processes are actually alive behind the screen sessions.
  any_alive=false
  for session in "${RUNNING_SESSIONS[@]}"; do
    pid=$(screen -ls 2>/dev/null | grep "${session}" | awk '{print $1}' | cut -d. -f1)
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      any_alive=true
      break
    fi
  done

  if [[ "${any_alive}" == "true" ]]; then
    echo -e "${RED}[ERROR]${NC} Sandbox is already running."
    echo -e "         Running sessions: ${RUNNING_SESSIONS[*]}"
    echo -e "         Run ${BOLD}make sandbox-stop${NC} first, or ${BOLD}make sandbox-reset${NC} to wipe and restart."
    exit 1
  else
    warn "Found stale screen sessions: ${RUNNING_SESSIONS[*]}"
    info "Cleaning up stale sessions..."
    for session in "${RUNNING_SESSIONS[@]}"; do
      screen -S "${session}" -X quit 2>/dev/null || true
    done
    success "Stale sessions cleaned up"
  fi
fi

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

save_pid() {
  local pid="$1" name="$2"
  echo "${pid} ${name}" >> "${PID_FILE}"
}

# Health check with retry+backoff. Returns 0 when healthy, 1 on timeout (non-fatal).
wait_healthy() {
  local url="$1" name="$2"
  local max_attempts=30 attempt=0 delay=1
  info "Waiting for ${name} at ${url} ..."
  while (( attempt < max_attempts )); do
    if curl -sf --max-time 2 "${url}" >/dev/null 2>&1; then
      success "${name} is up"
      return 0
    fi
    (( attempt++ ))
    sleep "${delay}"
    (( delay < 8 )) && (( delay *= 2 )) || true
  done
  warn "${name} did not become healthy after ${max_attempts} attempts (continuing)"
  return 1
}

# Start a process in a screen session (if USE_SCREEN=true) or background.
# Usage: start_process <session-name> <log-file> <cmd> [args...]
start_process() {
  local session="$1" log_file="$2"
  shift 2
  if [[ "${USE_SCREEN}" == "true" ]]; then
    # Kill existing session if running (idempotent restart).
    screen -S "${session}" -X quit 2>/dev/null || true
    screen -dmS "${session}" -L -Logfile "${log_file}" "$@"
    # screen -dm does not give us a PID to track; record 0 as sentinel.
    save_pid 0 "${session}"
  else
    "$@" >"${log_file}" 2>&1 &
    save_pid "$!" "${session}"
  fi
}

# --------------------------------------------------------------------------
# Step 1: Build daemon binary
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 1: Building daemon binary${NC}"
cd "${REPO_ROOT}"
make build-daemon
success "Daemon binary built: ${DAEMON_BIN}"

# --------------------------------------------------------------------------
# Step 2: Build sandbox apps (parallel, GOWORK=off)
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 2: Building sandbox apps${NC}"
mkdir -p "${BIN_DIR}"

build_app() {
  local app_dir="$1" bin_name="$2"
  info "Building ${bin_name}..."
  (cd "${app_dir}" && GOWORK=off go build -o "${BIN_DIR}/${bin_name}" .) 2>&1 | \
    sed "s/^/  [${bin_name}] /" || { warn "Failed to build ${bin_name}"; return 1; }
  success "Built ${bin_name}"
}

(build_app "${SANDBOX_DIR}/apps/users"        "users-svc"    ) &
(build_app "${SANDBOX_DIR}/apps/products"     "products-svc" ) &
(build_app "${SANDBOX_DIR}/apps/webhooks"     "webhooks-svc" ) &
(build_app "${SANDBOX_DIR}/apps/auth-service" "auth-svc"     ) &
(build_app "${SANDBOX_DIR}/apps/media"        "media-svc"    ) &
wait
success "All sandbox apps built"

# --------------------------------------------------------------------------
# Step 3: Create .data directory structure
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 3: Creating runtime directories${NC}"
mkdir -p "${DATA_DIR}" "${BIN_DIR}"
rm -f "${PID_FILE}"
info "Runtime directory: ${DATA_DIR}"

# --------------------------------------------------------------------------
# Step 4: Start sandbox apps
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 4: Starting sandbox apps${NC}"
if [[ "${USE_SCREEN}" == "true" ]]; then
  info "Using screen sessions (screen -ls to list, screen -r <name> to attach)"
fi

start_process "rioku-users"    "${DATA_DIR}/users.log"    "${BIN_DIR}/users-svc"    --port 9001
start_process "rioku-products" "${DATA_DIR}/products.log" "${BIN_DIR}/products-svc" --port 9002
start_process "rioku-webhooks" "${DATA_DIR}/webhooks.log" "${BIN_DIR}/webhooks-svc" --port 9003
start_process "rioku-auth"     "${DATA_DIR}/auth.log"     "${BIN_DIR}/auth-svc"     --port 9004
start_process "rioku-media"    "${DATA_DIR}/media.log"    "${BIN_DIR}/media-svc"    --port 9005

success "Sandbox apps started"

# --------------------------------------------------------------------------
# Step 5: Initialize and start the Rioku daemon
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 5: Initializing and starting Rioku daemon${NC}"

# Allow overriding root password via environment variable.
# Usage: SANDBOX_ROOT_PASSWORD=TestRoot1234! make sandbox
DESIRED_ROOT_PASSWORD="${SANDBOX_ROOT_PASSWORD:-}"

ROOT_PASSWORD=""
if [[ ! -f "${DAEMON_CONFIG}" ]]; then
  INIT_ARGS=(
    --config-file "${DAEMON_CONFIG}"
    --data-dir    "${DATA_DIR}"
    --store       sqlite
    --listen      ":7778"
    --non-interactive
  )
  if [[ -n "${DESIRED_ROOT_PASSWORD}" ]]; then
    INIT_ARGS+=(--root-password "${DESIRED_ROOT_PASSWORD}" --no-force-password-change)
  fi
  info "Running 'rioku init' (non-interactive, sqlite store) ..."
  INIT_OUTPUT="$( "${DAEMON_BIN}" init "${INIT_ARGS[@]}" 2>&1 | tee -a "${DATA_DIR}/init.log" )"

  # Enable dev_mode for local development (SameSite=Lax cookies, no TLS on admin).
  if grep -q "dev_mode:" "${DAEMON_CONFIG}"; then
    sed -i 's/dev_mode: false/dev_mode: true/' "${DAEMON_CONFIG}"
  else
    # Insert dev_mode under the auth: section.
    sed -i '/^auth:/a\  dev_mode: true' "${DAEMON_CONFIG}"
  fi
  success "dev_mode enabled in ${DAEMON_CONFIG}"

  # Raise rate limit for development (default 60 req/min is too low for seeding + testing).
  sed -i 's/requests_per_minute: 60/requests_per_minute: 6000/' "${DAEMON_CONFIG}"
  sed -i 's/burst_size: 10/burst_size: 100/' "${DAEMON_CONFIG}"

  # Use unprivileged port for Caddy traffic block (avoids needing root for :443).
  if grep -q "traffic_addrs:" "${DAEMON_CONFIG}"; then
    sed -i 's/- :443/- :8443/' "${DAEMON_CONFIG}"
  fi

  # Bind REST/admin to all interfaces for LAN access during development.
  sed -i 's/rest: :7778/rest: 0.0.0.0:7778/' "${DAEMON_CONFIG}"
  success "sandbox config patched (traffic :8443, REST 0.0.0.0:7778)"

  # Extract root password from init output.
  # Expected format:  "  Password: <password>"
  ROOT_PASSWORD="$(echo "${INIT_OUTPUT}" | grep -E '^\s+Password:' | awk '{print $NF}' || true)"
  if [[ -z "${ROOT_PASSWORD}" ]]; then
    warn "Could not capture root password from 'rioku init' output."
    warn "Check ${DATA_DIR}/init.log for the root credentials."
  else
    echo "${ROOT_PASSWORD}" > "${DATA_DIR}/root-password"
    success "Root password saved to ${DATA_DIR}/root-password"
  fi
else
  info "rioku.yaml already exists, skipping init"
  if [[ -f "${DATA_DIR}/root-password" ]]; then
    ROOT_PASSWORD="$(cat "${DATA_DIR}/root-password")"
  fi
fi

# Start daemon.
info "Starting Rioku daemon ..."
start_process "rioku-daemon" "${DATA_DIR}/daemon.log" \
  "${DAEMON_BIN}" start --config-file "${DAEMON_CONFIG}"
success "Daemon started"

# --------------------------------------------------------------------------
# Step 6: Health-check all 6 processes
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 6: Health checking all services${NC}"

wait_healthy "http://localhost:9001/health" "users"    || true
wait_healthy "http://localhost:9002/health" "products" || true
wait_healthy "http://localhost:9003/health" "webhooks" || true
wait_healthy "http://localhost:9004/health" "auth"     || true
wait_healthy "http://localhost:9005/health" "media"    || true
wait_healthy "${REST_BASE}/api/v1/health"   "daemon"   || true

# --------------------------------------------------------------------------
# Step 7: Seed configuration via REST (cookie auth)
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 7: Seeding configuration${NC}"

if [[ -z "${ROOT_PASSWORD}" ]]; then
  warn "No root password available — skipping config seed and user seed"
  warn "If the daemon was previously initialized, run 'make sandbox-seed-users' manually"
else
  # Login as root to get a session cookie.
  info "Logging in as root for config seeding..."
  LOGIN_RESP="$(curl -sf --max-time 10 \
    -c "${COOKIE_JAR}" \
    -H "Content-Type: application/json" \
    -H "User-Agent: rioku-seed-script/1.0" \
    -d "{\"username\": \"root\", \"password\": \"${ROOT_PASSWORD}\"}" \
    "${REST_BASE}/api/v1/auth/login" 2>/dev/null || true)"

  if [[ -z "${LOGIN_RESP}" ]]; then
    warn "Root login failed — daemon may not be ready yet. Skipping seed."
    warn "Run 'make sandbox-seed-users' after daemon is healthy."
  else
    success "Root login successful"

    # Apply seed config (delegates to the shared seed script).
    if ! bash "${SCRIPT_DIR}/seed-config.sh" "${REST_BASE}"; then
      warn "Config seed encountered errors (daemon API may not be fully implemented yet)"
    fi

    # Create API keys.
    info "Creating API keys from ${API_KEYS_FILE} ..."
    while IFS= read -r key_name; do
      scopes="$(python3 -c "
import json
d = json.load(open('${API_KEYS_FILE}'))
for k in d['keys']:
    if k['name'] == '${key_name}':
        print(','.join(k['scopes']))
        break
" 2>/dev/null || echo "admin")"

      resp="$(curl -sf --max-time 10 \
        -b "${COOKIE_JAR}" -c "${COOKIE_JAR}" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"${key_name}\", \"scopes\": \"${scopes}\"}" \
        "${REST_BASE}/api/v1/keys" 2>/dev/null || true)"

      if [[ -n "${resp}" ]]; then
        raw_key="$(echo "${resp}" | grep -o '"key":"[^"]*"' | cut -d'"' -f4 || true)"
        success "  API key '${key_name}' created: ${raw_key}"
      else
        warn "  Failed to create API key '${key_name}'"
      fi
    done < <(python3 -c "
import json
d = json.load(open('${API_KEYS_FILE}'))
for k in d['keys']:
    print(k['name'])
" 2>/dev/null || true)

    # Logout root session used for seeding.
    curl -sf --max-time 5 -b "${COOKIE_JAR}" \
      -X POST "${REST_BASE}/api/v1/auth/logout" >/dev/null 2>&1 || true
    rm -f "${COOKIE_JAR}"
    success "Root seeding session closed"
  fi
fi

# --------------------------------------------------------------------------
# Step 8: Seed test users
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 8: Seeding test users${NC}"
if [[ -n "${ROOT_PASSWORD}" ]]; then
  bash "${SCRIPT_DIR}/seed-users.sh" "${ROOT_PASSWORD}" || \
    warn "Test user seeding failed — run 'make sandbox-seed-users' manually"
else
  warn "Skipping test user seed (no root password)"
fi

# --------------------------------------------------------------------------
# Step 9: Summary table
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=======================================================${NC}"
echo -e "${BOLD}  Rioku Sandbox — Running${NC}"
echo -e "${BOLD}=======================================================${NC}"
echo ""
if [[ "${USE_SCREEN}" == "true" ]]; then
  echo -e "  ${CYAN}Process management:${NC} screen"
  echo -e "  ${CYAN}List sessions:${NC}  screen -ls"
  echo -e "  ${CYAN}Attach daemon:${NC}  screen -r rioku-daemon"
  echo -e "  ${CYAN}Detach:${NC}         Ctrl-A D"
  echo ""
fi
echo -e "  ${CYAN}Service        Port   Log${NC}"
echo -e "  ─────────────────────────────────────────────────────"
echo -e "  users          9001   ${DATA_DIR}/users.log"
echo -e "  products       9002   ${DATA_DIR}/products.log"
echo -e "  webhooks       9003   ${DATA_DIR}/webhooks.log"
echo -e "  auth           9004   ${DATA_DIR}/auth.log"
echo -e "  media          9005   ${DATA_DIR}/media.log"
echo -e "  daemon (REST)  7778   ${DATA_DIR}/daemon.log"
echo -e "  daemon (gRPC)  7777   ${DATA_DIR}/daemon.log"
echo ""
echo -e "  ${CYAN}Useful endpoints:${NC}"
echo -e "  Health:  ${REST_BASE}/api/v1/health"
echo -e "  Login:   POST ${REST_BASE}/api/v1/auth/login"
echo -e "  Config:  ${REST_BASE}/api/v1/config"
echo -e "  Keys:    ${REST_BASE}/api/v1/keys"
echo ""
if [[ -n "${ROOT_PASSWORD}" ]]; then
  echo -e "  ${CYAN}Root credentials:${NC} root / ${BOLD}${ROOT_PASSWORD}${NC}"
  echo -e "  (password saved to ${DATA_DIR}/root-password)"
fi
echo ""
echo -e "  ${CYAN}Test users:${NC} testadmin/TestAdmin123!, testviewer/TestView123!, ..."
echo -e "  (full list: make sandbox-seed-users)"
echo ""
echo -e "  ${CYAN}Smoke tests:${NC}"
echo -e "  make sandbox-test-auth    # auth flows only"
echo -e "  make sandbox-test-smoke   # full stack"
echo ""
echo -e "  Stop: ${BOLD}make sandbox-stop${NC}  or  ${BOLD}bash sandbox/scripts/stop.sh${NC}"
echo -e "${BOLD}=======================================================${NC}"
echo ""
