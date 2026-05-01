#!/usr/bin/env bash
# sandbox/scripts/start.sh — Start the Rioku sandbox environment.
# Builds all binaries, launches all processes (PID files + log files),
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
: "${SANDBOX_PORT_CADDY_ADMIN:=2019}"
: "${SANDBOX_PORT_USERS:=9001}"
: "${SANDBOX_PORT_PRODUCTS:=9002}"
: "${SANDBOX_PORT_WEBHOOKS:=9003}"
: "${SANDBOX_PORT_AUTH:=9004}"
: "${SANDBOX_PORT_MEDIA:=9005}"
: "${SANDBOX_DEV_MODE:=true}"
: "${SANDBOX_RATE_LIMIT_RPM:=6000}"
: "${SANDBOX_RATE_LIMIT_BURST:=100}"
: "${SANDBOX_REST_BIND:=0.0.0.0}"

# OTLP smoke-test plumbing (off by default). When SANDBOX_OTLP_ENABLED=true,
# start.sh also spins up sandbox-otlp-listener on SANDBOX_OTLP_PORT and the
# rioku.yaml template wires the daemon's OTLP exporter to it. The listener
# exposes a status JSON on SANDBOX_OTLP_STATUS_PORT for the smoke test.
: "${SANDBOX_OTLP_ENABLED:=false}"
: "${SANDBOX_OTLP_PORT:=4318}"
: "${SANDBOX_OTLP_STATUS_PORT:=4319}"
: "${SANDBOX_OTLP_ENDPOINT:=localhost:${SANDBOX_OTLP_PORT}}"

# Export all SANDBOX_ vars so envsubst can see them
export SANDBOX_PORT_REST SANDBOX_PORT_GRPC SANDBOX_PORT_TRAFFIC SANDBOX_PORT_CADDY_ADMIN
export SANDBOX_PORT_USERS SANDBOX_PORT_PRODUCTS SANDBOX_PORT_WEBHOOKS SANDBOX_PORT_AUTH SANDBOX_PORT_MEDIA
export SANDBOX_DEV_MODE SANDBOX_RATE_LIMIT_RPM SANDBOX_RATE_LIMIT_BURST SANDBOX_REST_BIND
export SANDBOX_OTLP_ENABLED SANDBOX_OTLP_PORT SANDBOX_OTLP_STATUS_PORT SANDBOX_OTLP_ENDPOINT

# --------------------------------------------------------------------------
# Derived paths and addresses
# --------------------------------------------------------------------------
DATA_DIR="${SANDBOX_DIR}/.data"
BIN_DIR="${DATA_DIR}/bin"
LOG_DIR="${DATA_DIR}/logs"
PID_DIR="${DATA_DIR}/pids"
DAEMON_BIN="${REPO_ROOT}/bin/rioku"
DAEMON_CONFIG="${DATA_DIR}/rioku.yaml"
export SANDBOX_DATA_DIR="${DATA_DIR}"
SEED_FILE="${SANDBOX_DIR}/config/seed.json"
API_KEYS_FILE="${SANDBOX_DIR}/config/api-keys.json"
REST_ADDR="localhost:${SANDBOX_PORT_REST}"
REST_BASE="http://${REST_ADDR}"
COOKIE_JAR="${DATA_DIR}/root-cookies.txt"

# --------------------------------------------------------------------------
# Trap ERR — cleanup on failure
# --------------------------------------------------------------------------
cleanup_on_error() {
  echo -e "\n${RED}[ERROR]${NC} Start failed. Cleaning up..."
  if [[ -d "${PID_DIR}" ]]; then
    for pid_file in "${PID_DIR}"/*.pid; do
      [[ -f "${pid_file}" ]] || continue
      local pid name
      pid=$(cat "${pid_file}")
      name=$(basename "${pid_file}" .pid)
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
        echo -e "  ${RED}killing${NC} ${name} (pid ${pid})"
        kill "${pid}" 2>/dev/null || true
      fi
      rm -f "${pid_file}"
    done
  fi
  rm -f "${COOKIE_JAR}"
  exit 1
}
trap cleanup_on_error ERR

# --------------------------------------------------------------------------
# Pre-flight: check for existing sandbox
# --------------------------------------------------------------------------
any_running=false
if [[ -d "${PID_DIR}" ]]; then
  for pid_file in "${PID_DIR}"/*.pid; do
    [[ -f "${pid_file}" ]] || continue
    pid=$(cat "${pid_file}")
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      any_running=true
      break
    fi
  done
fi

if [[ "${any_running}" == "true" ]]; then
  echo -e "${RED}[ERROR]${NC} Sandbox is already running."
  echo -e "         Run ${BOLD}make sandbox-stop${NC} first, or ${BOLD}make sandbox-reset${NC} to wipe and restart."
  exit 1
fi

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

# Portable sed -i (macOS requires '' after -i, Linux does not).
sed_i() {
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# --------------------------------------------------------------------------
# Dependency checks
# --------------------------------------------------------------------------
check_dependencies() {
  local missing=()
  command -v go       >/dev/null 2>&1 || missing+=("go")
  command -v curl     >/dev/null 2>&1 || missing+=("curl")
  command -v python3  >/dev/null 2>&1 || missing+=("python3")
  command -v envsubst >/dev/null 2>&1 || missing+=("gettext (for envsubst)")
  command -v make     >/dev/null 2>&1 || missing+=("make")
  if (( ${#missing[@]} > 0 )); then
    echo -e "${RED}[ERROR]${NC} Missing required tools: ${missing[*]}"
    echo -e "         Install them and try again."
    exit 1
  fi
}
check_dependencies

# Launch a service as a background process with PID file tracking.
# Usage: launch_service <name> <cmd> [args...]
launch_service() {
  local name="$1"
  shift
  local log="${LOG_DIR}/${name}.log"
  local pid_file="${PID_DIR}/${name}.pid"

  mkdir -p "${LOG_DIR}" "${PID_DIR}"

  # Kill existing if running
  if [[ -f "$pid_file" ]]; then
    local old_pid
    old_pid=$(cat "$pid_file")
    if kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$pid_file"
  fi

  "$@" > "$log" 2>&1 &
  local pid=$!
  echo "$pid" > "$pid_file"
  echo -e "${GREEN}[OK]${NC}    Started ${name} (PID ${pid})"
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

# --------------------------------------------------------------------------
# Step 1+2: Build daemon and sandbox apps in parallel
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 1: Building all binaries (parallel)${NC}"
mkdir -p "${BIN_DIR}"

# Build a sandbox app only if its binary is missing or stale vs .go sources.
build_app_if_changed() {
  local name="$1"
  local src_dir="${SANDBOX_DIR}/apps/${name}"
  local bin="${BIN_DIR}/sandbox-${name}"

  # Check if binary exists and is newer than all .go source files
  if [[ -f "$bin" ]]; then
    local needs_rebuild=false
    while IFS= read -r -d '' gofile; do
      if [[ "$gofile" -nt "$bin" ]]; then
        needs_rebuild=true
        break
      fi
    done < <(find "$src_dir" -name "*.go" -print0)

    if [[ "$needs_rebuild" == "false" ]]; then
      info "Skipping ${name} build (binary up to date)"
      return 0
    fi
  fi

  info "Building ${name}..."
  GOWORK=off go build -o "$bin" "${src_dir}/main.go"
}

# Build daemon in background (skip web rebuild — use last web-build)
make -C "${REPO_ROOT}" build-daemon-fast 2>&1 | sed 's/^/  [daemon-build] /' &

# Build apps in parallel (skip if unchanged)
for app in users products webhooks auth-service media; do
  build_app_if_changed "$app" &
done

# Wait for all background jobs (app builds + daemon build pipe)
wait
info "All binaries built"

# --------------------------------------------------------------------------
# Step 3: Create .data directory structure
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 3: Creating runtime directories${NC}"
mkdir -p "${DATA_DIR}" "${BIN_DIR}" "${LOG_DIR}" "${PID_DIR}"
info "Runtime directory: ${DATA_DIR}"

# --------------------------------------------------------------------------
# Step 4: Start sandbox apps
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 4: Starting sandbox apps${NC}"

launch_service "users"    "${BIN_DIR}/sandbox-users"        --port "${SANDBOX_PORT_USERS}"
launch_service "products" "${BIN_DIR}/sandbox-products"     --port "${SANDBOX_PORT_PRODUCTS}"
launch_service "webhooks" "${BIN_DIR}/sandbox-webhooks"     --port "${SANDBOX_PORT_WEBHOOKS}"
launch_service "auth"     "${BIN_DIR}/sandbox-auth-service" --port "${SANDBOX_PORT_AUTH}"
launch_service "media"    "${BIN_DIR}/sandbox-media"        --port "${SANDBOX_PORT_MEDIA}"

success "Sandbox apps started"

# --------------------------------------------------------------------------
# Step 4b: Optional OTLP listener (for OTLP smoke test)
# --------------------------------------------------------------------------
if [[ "${SANDBOX_OTLP_ENABLED}" == "true" || "${SANDBOX_OTLP_ENABLED}" == "1" ]]; then
  echo ""
  echo -e "${BOLD}==> Step 4b: Starting OTLP listener${NC}"
  OTLP_LISTENER_BIN="${BIN_DIR}/sandbox-otlp-listener"
  OTLP_SRC_DIR="${SANDBOX_DIR}/tools/otlp-listener"
  if [[ ! -f "${OTLP_LISTENER_BIN}" ]] || [[ "${OTLP_SRC_DIR}/main.go" -nt "${OTLP_LISTENER_BIN}" ]]; then
    info "Building OTLP listener..."
    (cd "${OTLP_SRC_DIR}" && GOWORK=off go build -o "${OTLP_LISTENER_BIN}" .)
  fi
  launch_service "otlp" "${OTLP_LISTENER_BIN}" \
    --port "${SANDBOX_OTLP_PORT}" \
    --status-port "${SANDBOX_OTLP_STATUS_PORT}"
  success "OTLP listener on :${SANDBOX_OTLP_PORT} (status :${SANDBOX_OTLP_STATUS_PORT})"
else
  info "OTLP listener disabled (set SANDBOX_OTLP_ENABLED=true to enable for OTLP smoke test)"
fi

# --------------------------------------------------------------------------
# Step 5: Initialize and start the Rioku daemon
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 5: Initializing and starting Rioku daemon${NC}"

# Generate or use provided root password upfront (avoids brittle stdout parsing).
if [[ -n "${SANDBOX_ROOT_PASSWORD:-}" ]]; then
  ROOT_PASSWORD="${SANDBOX_ROOT_PASSWORD}"
elif [[ -f "${DATA_DIR}/root-password" ]]; then
  ROOT_PASSWORD="$(cat "${DATA_DIR}/root-password")"
else
  # Generate a random password that meets complexity requirements.
  ROOT_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 16)Aa1!"
fi

CONFIG_TEMPLATE="${SANDBOX_DIR}/config/rioku.sandbox.yaml.tmpl"
if [[ ! -f "${DAEMON_CONFIG}" ]]; then
  INIT_ARGS=(
    --config-file "${DAEMON_CONFIG}"
    --data-dir    "${DATA_DIR}"
    --store       sqlite
    --listen      ":${SANDBOX_PORT_REST}"
    --non-interactive
    --no-force-password-change
    --root-password "${ROOT_PASSWORD}"
  )
  info "Running 'rioku init' (non-interactive, sqlite store) ..."
  "${DAEMON_BIN}" init "${INIT_ARGS[@]}" 2>&1 | tee -a "${DATA_DIR}/init.log"

  # Save password reliably (no stdout parsing needed).
  echo "${ROOT_PASSWORD}" > "${DATA_DIR}/root-password"
  success "Root password saved to ${DATA_DIR}/root-password"

  # Extract the Caddy binary path that init discovered/downloaded before overwriting config.
  SANDBOX_CADDY_BINARY="$(grep -E '^\s*binary:' "${DAEMON_CONFIG}" | awk '{print $2}' || echo "caddy")"
  export SANDBOX_CADDY_BINARY

  # Generate config from template (replaces brittle sed patching).
  export SANDBOX_DATA_DIR="${DATA_DIR}"
  info "Generating config from template: ${CONFIG_TEMPLATE}"
  envsubst < "${CONFIG_TEMPLATE}" > "${DAEMON_CONFIG}"
  success "sandbox config generated (traffic :${SANDBOX_PORT_TRAFFIC}, REST ${SANDBOX_REST_BIND}:${SANDBOX_PORT_REST}, dev_mode=${SANDBOX_DEV_MODE})"
else
  info "rioku.yaml already exists, skipping init"
fi

# Start daemon.
info "Starting Rioku daemon ..."
launch_service "daemon" "${DAEMON_BIN}" start --config-file "${DAEMON_CONFIG}"
success "Daemon started"

# --------------------------------------------------------------------------
# Step 6: Health-check all 6 processes (parallel)
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 6: Health checking all services${NC}"

info "Waiting for services to be healthy..."
failed=false

wait_for_health() {
  local name="$1"
  local url="$2"
  local max_wait="${3:-15}"

  for i in $(seq 1 "$max_wait"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo -e "  ${GREEN}●${NC}  ${name} healthy"
      return 0
    fi
    sleep 1
  done
  echo -e "  ${RED}●${NC}  ${name} FAILED (not healthy after ${max_wait}s)"
  return 1
}

# Check all in parallel — collect PIDs explicitly
health_pids=()
wait_for_health "users"    "http://localhost:${SANDBOX_PORT_USERS}/health"    15 & health_pids+=($!)
wait_for_health "products" "http://localhost:${SANDBOX_PORT_PRODUCTS}/health" 15 & health_pids+=($!)
wait_for_health "webhooks" "http://localhost:${SANDBOX_PORT_WEBHOOKS}/health" 15 & health_pids+=($!)
wait_for_health "auth"     "http://localhost:${SANDBOX_PORT_AUTH}/health"     15 & health_pids+=($!)
wait_for_health "media"    "http://localhost:${SANDBOX_PORT_MEDIA}/health"    15 & health_pids+=($!)
wait_for_health "daemon"   "${REST_BASE}/api/v1/health"                      20 & health_pids+=($!)

# Wait for each health check
for pid in "${health_pids[@]}"; do
  wait "$pid" 2>/dev/null || failed=true
done

if [[ "$failed" == "true" ]]; then
  warn "Some services failed to start. Check logs: make sandbox-logs"
fi

# --------------------------------------------------------------------------
# Step 7: Seed all sandbox data (roles, services, policies, routes, users, API keys)
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 7: Seeding sandbox data${NC}"

if [[ -z "${ROOT_PASSWORD}" ]]; then
  warn "No root password available — skipping seed"
  warn "If the daemon was previously initialized, run 'make sandbox-seed' manually"
else
  info "Seeding sandbox data via 'rioku seed' ..."
  if ! "${DAEMON_BIN}" seed \
    --file "${SANDBOX_DIR}/config/seed.yaml" \
    --target "http://localhost:${SANDBOX_PORT_REST}" \
    --password "${ROOT_PASSWORD}"; then
    warn "Seed encountered errors — run 'make sandbox-seed' manually after daemon is healthy"
  else
    success "Sandbox data seeded"
  fi
fi

# --------------------------------------------------------------------------
# Step 9: Summary table
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=======================================================${NC}"
echo -e "${BOLD}  Rioku Sandbox — Running${NC}"
echo -e "${BOLD}=======================================================${NC}"
echo ""
echo -e "  ${CYAN}Process management:${NC} PID files (${PID_DIR}/)"
echo -e "  ${CYAN}Log directory:${NC}      ${LOG_DIR}/"
echo -e "  ${CYAN}Tail all logs:${NC}      make sandbox-logs"
echo ""
echo -e "  ${CYAN}Service        Port   Log${NC}"
echo -e "  ─────────────────────────────────────────────────────"
echo -e "  users          ${SANDBOX_PORT_USERS}   ${LOG_DIR}/users.log"
echo -e "  products       ${SANDBOX_PORT_PRODUCTS}   ${LOG_DIR}/products.log"
echo -e "  webhooks       ${SANDBOX_PORT_WEBHOOKS}   ${LOG_DIR}/webhooks.log"
echo -e "  auth           ${SANDBOX_PORT_AUTH}   ${LOG_DIR}/auth.log"
echo -e "  media          ${SANDBOX_PORT_MEDIA}   ${LOG_DIR}/media.log"
echo -e "  daemon (REST)  ${SANDBOX_PORT_REST}   ${LOG_DIR}/daemon.log"
echo -e "  daemon (gRPC)  ${SANDBOX_PORT_GRPC}   ${LOG_DIR}/daemon.log"
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
