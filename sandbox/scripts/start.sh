#!/usr/bin/env bash
# sandbox/scripts/start.sh — Start the Rioku sandbox environment.
# Builds all binaries, launches all 5 sandbox apps and the daemon, seeds config.
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
BIN_DIR="${DATA_DIR}/bin"
PID_FILE="${DATA_DIR}/pids"
DAEMON_BIN="${REPO_ROOT}/bin/rioku"
DAEMON_CONFIG="${DATA_DIR}/rioku.yaml"
SEED_FILE="${SANDBOX_DIR}/config/seed.json"
API_KEYS_FILE="${SANDBOX_DIR}/config/api-keys.json"
REST_ADDR="localhost:7778"
REST_BASE="http://${REST_ADDR}"

# --------------------------------------------------------------------------
# Trap ERR — cleanup on failure
# --------------------------------------------------------------------------
cleanup_on_error() {
  echo -e "\n${RED}[ERROR]${NC} Start failed. Cleaning up..."
  if [[ -f "${PID_FILE}" ]]; then
    # shellcheck disable=SC2034
    while IFS=' ' read -r pid name; do
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
        echo -e "  ${RED}killing${NC} ${name} (pid ${pid})"
        kill "${pid}" 2>/dev/null || true
      fi
    done < "${PID_FILE}"
    rm -f "${PID_FILE}"
  fi
  exit 1
}
trap cleanup_on_error ERR

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${RED}[WARN]${NC}  $*"; }

save_pid() {
  local pid="$1" name="$2"
  echo "${pid} ${name}" >> "${PID_FILE}"
}

# Health check with retry+backoff. Returns 0 when healthy.
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
  GOWORK=off go build -o "${BIN_DIR}/${bin_name}" "${app_dir}" 2>&1 | \
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
# Step 4: Start sandbox apps in background, save PIDs
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 4: Starting sandbox apps${NC}"

start_app() {
  local bin="$1" name="$2" port="$3"
  shift 3
  local log_file="${DATA_DIR}/${name}.log"
  info "Starting ${name} on :${port} ..."
  "${bin}" --port "${port}" "$@" >"${log_file}" 2>&1 &
  save_pid "$!" "${name}"
  success "${name} started (pid $!)"
}

start_app "${BIN_DIR}/users-svc"    "users"    9001
start_app "${BIN_DIR}/products-svc" "products" 9002
start_app "${BIN_DIR}/webhooks-svc" "webhooks" 9003
start_app "${BIN_DIR}/auth-svc"     "auth"     9004
start_app "${BIN_DIR}/media-svc"    "media"    9005

# --------------------------------------------------------------------------
# Step 5: Initialize and start the Rioku daemon
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 5: Initializing and starting Rioku daemon${NC}"
DAEMON_LOG="${DATA_DIR}/daemon.log"

# Initialize if not already done (generates rioku.yaml + bootstrap token).
if [[ ! -f "${DAEMON_CONFIG}" ]]; then
  info "Running 'rioku init' (non-interactive, sqlite store) ..."
  BOOTSTRAP_TOKEN="$( "${DAEMON_BIN}" init \
    --config-file "${DAEMON_CONFIG}" \
    --data-dir    "${DATA_DIR}" \
    --store       sqlite \
    --listen      ":7778" \
    --non-interactive \
    2>&1 | tee -a "${DATA_DIR}/init.log" \
    | grep "Bootstrap token:" | awk '{print $NF}' )"
  if [[ -z "${BOOTSTRAP_TOKEN}" ]]; then
    warn "Could not capture bootstrap token from 'rioku init' output."
    warn "Check ${DATA_DIR}/init.log for details."
    BOOTSTRAP_TOKEN=""
  else
    echo "${BOOTSTRAP_TOKEN}" > "${DATA_DIR}/bootstrap-token"
    success "Bootstrap token captured and saved to ${DATA_DIR}/bootstrap-token"
  fi
else
  info "rioku.yaml already exists, skipping init"
  if [[ -f "${DATA_DIR}/bootstrap-token" ]]; then
    BOOTSTRAP_TOKEN="$(cat "${DATA_DIR}/bootstrap-token")"
  else
    BOOTSTRAP_TOKEN=""
  fi
fi

# Start daemon in the background.
info "Starting Rioku daemon ..."
"${DAEMON_BIN}" start \
  --config-file "${DAEMON_CONFIG}" \
  >"${DAEMON_LOG}" 2>&1 &
DAEMON_PID=$!
save_pid "${DAEMON_PID}" "daemon"
success "Daemon started (pid ${DAEMON_PID})"

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
# Step 7: Seed configuration via REST
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Step 7: Seeding configuration${NC}"

# Exchange bootstrap token for an access token.
ACCESS_TOKEN=""
if [[ -n "${BOOTSTRAP_TOKEN}" ]]; then
  info "Exchanging bootstrap token for access token ..."
  TOKEN_RESP="$(curl -sf --max-time 10 \
    -H "Content-Type: application/json" \
    -d "{\"token\": \"${BOOTSTRAP_TOKEN}\"}" \
    "${REST_BASE}/api/v1/auth/token" 2>/dev/null || true)"

  if [[ -n "${TOKEN_RESP}" ]]; then
    ACCESS_TOKEN="$(echo "${TOKEN_RESP}" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4 || true)"
    if [[ -n "${ACCESS_TOKEN}" ]]; then
      success "Access token obtained"
    else
      warn "Could not extract access_token from response. Token exchange may have failed."
      warn "Response: ${TOKEN_RESP}"
    fi
  else
    warn "Token exchange request failed (daemon REST API may not be ready or endpoint not implemented yet)"
  fi
else
  warn "No bootstrap token available — skipping auth and config seed"
fi

# Apply seed config: services, routes, policies.
if [[ -n "${ACCESS_TOKEN}" ]]; then
  info "Seeding services, routes, and policies from ${SEED_FILE} ..."

  seed_failed=0

  # Seed each service.
  service_count="$(python3 -c "import json,sys; d=json.load(open('${SEED_FILE}')); print(len(d.get('services',[])))" 2>/dev/null || echo 0)"
  info "  Seeding ${service_count} services..."
  python3 - <<'PYEOF' 2>/dev/null || seed_failed=1
import json, sys, urllib.request, urllib.error

seed_file = "${SEED_FILE}"
base_url  = "${REST_BASE}"
token     = "${ACCESS_TOKEN}"

with open(seed_file) as f:
    seed = json.load(f)

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}",
}

def post(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(f"{base_url}{path}", data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

service_ids = {}
for svc in seed.get("services", []):
    change = {"service": {"action": "UPSERT", "service": {
        "name":      svc["name"],
        "upstreams": svc["upstreams"],
        "lbPolicy":  svc["lbPolicy"],
    }}}
    status, body = post("/api/v1/config", change)
    resp_data = json.loads(body) if body else {}
    svc_id = resp_data.get("id") or resp_data.get("service", {}).get("id", "")
    service_ids[svc["name"]] = svc_id
    print(f"  service {svc['name']}: HTTP {status}")

for route in seed.get("routes", []):
    svc_ref = route.pop("serviceRef", "")
    svc_id  = service_ids.get(svc_ref, "")
    r = {
        "name":     route["name"],
        "enabled":  route.get("enabled", True),
        "matchers": route.get("matchers", []),
    }
    if svc_id:
        r["serviceId"] = svc_id
    change = {"route": {"action": "UPSERT", "route": r}}
    status, body = post("/api/v1/config", change)
    print(f"  route {route['name']}: HTTP {status}")

for pol in seed.get("policies", []):
    change = {"policy": {"action": "UPSERT", "policy": {
        "name":   pol["name"],
        "type":   pol["type"],
        "config": pol.get("config", {}),
    }}}
    status, body = post("/api/v1/config", change)
    print(f"  policy {pol['name']}: HTTP {status}")
PYEOF

  if (( seed_failed )); then
    warn "Config seed encountered errors (daemon API may not be fully implemented yet)"
  else
    success "Config seed complete"
  fi

  # Create API keys.
  info "Creating API keys from ${API_KEYS_FILE} ..."
  keys_failed=0
  while IFS= read -r key_name; do
    scopes="$(python3 -c "
import json, sys
d = json.load(open('${API_KEYS_FILE}'))
for k in d['keys']:
    if k['name'] == '${key_name}':
        print(','.join(k['scopes']))
        break
" 2>/dev/null || echo "admin")"

    resp="$(curl -sf --max-time 10 \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -d "{\"name\": \"${key_name}\", \"scopes\": \"${scopes}\"}" \
      "${REST_BASE}/api/v1/keys" 2>/dev/null || true)"

    if [[ -n "${resp}" ]]; then
      raw_key="$(echo "${resp}" | grep -o '"key":"[^"]*"' | cut -d'"' -f4 || true)"
      success "  API key '${key_name}' created: ${raw_key}"
    else
      warn "  Failed to create API key '${key_name}' (endpoint may not be implemented yet)"
      (( keys_failed++ )) || true
    fi
  done < <(python3 -c "
import json
d = json.load(open('${API_KEYS_FILE}'))
for k in d['keys']:
    print(k['name'])
" 2>/dev/null || true)
else
  warn "Skipping config seed (no access token)"
fi

# --------------------------------------------------------------------------
# Step 8: Summary table
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=======================================================${NC}"
echo -e "${BOLD}  Rioku Sandbox — Running${NC}"
echo -e "${BOLD}=======================================================${NC}"
echo ""
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
echo -e "  Config:  ${REST_BASE}/api/v1/config"
echo -e "  Keys:    ${REST_BASE}/api/v1/keys"
echo ""
if [[ -n "${BOOTSTRAP_TOKEN}" ]]; then
echo -e "  ${CYAN}Bootstrap token:${NC} ${BOLD}${BOOTSTRAP_TOKEN}${NC}"
echo -e "  (saved to ${DATA_DIR}/bootstrap-token)"
fi
if [[ -n "${ACCESS_TOKEN}" ]]; then
echo -e "  ${CYAN}Access token:${NC}   ${BOLD}${ACCESS_TOKEN:0:40}...${NC}"
fi
echo ""
echo -e "  PIDs: ${PID_FILE}"
echo -e "  Stop: ${BOLD}make sandbox-stop${NC}  or  ${BOLD}bash sandbox/scripts/stop.sh${NC}"
echo -e "${BOLD}=======================================================${NC}"
echo ""
