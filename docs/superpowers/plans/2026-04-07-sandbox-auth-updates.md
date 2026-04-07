# Plan 5 of 5 — Auth Security Overhaul: Sandbox Auth Updates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the sandbox to work with the new auth system (Plan 1: cookie-based sessions, username/password login) and add smoke test scripts that validate auth flows, RBAC enforcement, and full-stack behavior.

**Spec:**
- `contrib-docs/design/auth-security-overhaul.md` (Parts 1–3)
- `contrib-docs/design/testing-infrastructure.md` (Sandbox as Development Validation Standard section)

**Dependencies:**
- Plan 1 complete: `POST /api/v1/auth/login` returns cookie, `POST /api/v1/auth/logout` clears it, `GET /api/v1/users` exists, session cookie auth is enforced on all `/api/v1/` routes.
- Plan 2 complete (for full smoke test): RBAC enforcement active, `POST /api/v1/users` creates users with roles, session revocation via `DELETE /api/v1/sessions/{id}` works.

**Series context:**
- Plan 1 — User accounts + session management
- Plan 2 — RBAC + permission enforcement
- Plan 3 — TOTP 2FA
- Plan 4 — Security headers + route loaders
- **Plan 5 (this) — Sandbox updates + smoke tests**

---

## What This Plan Changes

| File | Change |
|---|---|
| `sandbox/scripts/start.sh` | Replace bootstrap-token flow with username/password login; add user seeding step; add screen-based process management |
| `sandbox/scripts/stop.sh` | Add screen session cleanup alongside PID-based cleanup |
| `sandbox/config/test-users.json` | New — test user seed definitions |
| `sandbox/scripts/test-auth.sh` | New — auth smoke test script |
| `sandbox/scripts/test-smoke.sh` | New — full-stack smoke test script |
| `Makefile` | Add `sandbox-restart-daemon`, `sandbox-test-auth`, `sandbox-test-smoke`, `sandbox-seed-users` targets |

---

## Task 1: Add `sandbox/config/test-users.json`

**File:** `sandbox/config/test-users.json`

This file defines the test users seeded after `rioku init`. Passwords are deliberately non-secret — local dev sandbox only.

- [ ] **Step 1: Create `sandbox/config/test-users.json`**

```json
{
  "_comment": "Test users for sandbox development and smoke tests. Non-secret passwords — local dev only.",
  "users": [
    {
      "username": "testadmin",
      "password": "TestAdmin123!",
      "roles": ["admin"],
      "status": "active"
    },
    {
      "username": "testoperator",
      "password": "TestOp123!",
      "roles": ["operator"],
      "status": "active"
    },
    {
      "username": "testviewer",
      "password": "TestView123!",
      "roles": ["viewer"],
      "status": "active"
    },
    {
      "username": "testmulti",
      "password": "TestMulti123!",
      "roles": ["operator", "auditor"],
      "status": "active"
    },
    {
      "username": "test2fa",
      "password": "Test2FA123!",
      "roles": ["admin"],
      "status": "active",
      "totp_enabled": false,
      "_note": "TOTP enabled manually during test setup; totp_secret written to .data/test-users-state.json after seeding"
    },
    {
      "username": "testlocked",
      "password": "TestLocked123!",
      "roles": ["viewer"],
      "status": "locked"
    },
    {
      "username": "testsuspended",
      "password": "TestSusp123!",
      "roles": ["viewer"],
      "status": "suspended"
    }
  ]
}
```

**Note on `testmulti`:** The `auditor` role may not be a built-in role. The seed script creates it as a custom role if it does not exist before assigning it.

**Note on `test2fa`:** TOTP is enabled via the API after the user is created (setup flow: call `POST /api/v1/auth/totp/setup`, then `POST /api/v1/auth/totp/verify` with the generated code). The resulting TOTP secret is saved to `sandbox/.data/test-users-state.json` for use by the smoke tests.

---

## Task 2: Add `sandbox/scripts/seed-users.sh`

This script is called by `start.sh` after init and can be run independently via `make sandbox-seed-users`. It reads `test-users.json`, creates each user via `POST /api/v1/users`, sets their status, and assigns roles. It requires an active root session cookie.

**File:** `sandbox/scripts/seed-users.sh`

- [ ] **Step 1: Create `sandbox/scripts/seed-users.sh`**

```bash
#!/usr/bin/env bash
# sandbox/scripts/seed-users.sh — Seed test users into a running sandbox.
# Requires: sandbox running at localhost:7778 with an active root session.
# Usage: bash sandbox/scripts/seed-users.sh <root-password>
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SANDBOX_DIR="${REPO_ROOT}/sandbox"
DATA_DIR="${SANDBOX_DIR}/.data"
TEST_USERS_FILE="${SANDBOX_DIR}/config/test-users.json"
STATE_FILE="${DATA_DIR}/test-users-state.json"
REST_BASE="http://localhost:7778"
COOKIE_JAR="${DATA_DIR}/seed-cookies.txt"

ROOT_PASSWORD="${1:-}"
if [[ -z "${ROOT_PASSWORD}" ]]; then
  # Try to read from saved state.
  if [[ -f "${DATA_DIR}/root-password" ]]; then
    ROOT_PASSWORD="$(cat "${DATA_DIR}/root-password")"
  else
    die "Usage: $0 <root-password>  (or save password to ${DATA_DIR}/root-password)"
  fi
fi

# --------------------------------------------------------------------------
# Step 1: Login as root to get a session cookie
# --------------------------------------------------------------------------
info "Logging in as root..."
login_resp="$(curl -sf --max-time 10 \
  -c "${COOKIE_JAR}" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"root\", \"password\": \"${ROOT_PASSWORD}\"}" \
  "${REST_BASE}/api/v1/auth/login" 2>/dev/null)" || \
  die "Login failed — is the daemon running at ${REST_BASE}?"

success "Root login successful"

# --------------------------------------------------------------------------
# Helper: make authenticated request with cookie jar
# --------------------------------------------------------------------------
api() {
  local method="$1" path="$2" data="${3:-}"
  local args=(-sf --max-time 10 -b "${COOKIE_JAR}" -c "${COOKIE_JAR}"
               -H "Content-Type: application/json"
               -X "${method}" "${REST_BASE}${path}")
  if [[ -n "${data}" ]]; then
    args+=(-d "${data}")
  fi
  curl "${args[@]}" 2>/dev/null || true
}

# --------------------------------------------------------------------------
# Step 2: Ensure the "auditor" custom role exists
# --------------------------------------------------------------------------
info "Ensuring 'auditor' custom role exists..."
role_resp="$(api POST /api/v1/roles \
  '{"name":"auditor","description":"Read-only audit access with extra audit:read permission"}')"
if echo "${role_resp}" | grep -q '"id"'; then
  success "Role 'auditor' created"
else
  # May already exist — check.
  existing="$(api GET /api/v1/roles 2>/dev/null || true)"
  if echo "${existing}" | grep -q '"auditor"'; then
    info "Role 'auditor' already exists"
  else
    warn "Could not create 'auditor' role — testmulti will get operator role only"
  fi
fi

# --------------------------------------------------------------------------
# Step 3: Create each test user
# --------------------------------------------------------------------------
info "Seeding test users from ${TEST_USERS_FILE}..."

# Track created user IDs for state file.
declare -A USER_IDS

python3 - <<PYEOF
import json, subprocess, sys

test_users_file = "${TEST_USERS_FILE}"
rest_base       = "${REST_BASE}"
cookie_jar      = "${COOKIE_JAR}"
data_dir        = "${DATA_DIR}"

with open(test_users_file) as f:
    config = json.load(f)

import urllib.request, urllib.error

def api(method, path, payload=None):
    url = f"{rest_base}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    # Read cookie jar for session cookie.
    session_id = ""
    try:
        with open(cookie_jar) as cf:
            for line in cf:
                if "rioku_session" in line:
                    session_id = line.strip().split("\t")[-1]
                    break
    except FileNotFoundError:
        pass
    if session_id:
        req.add_header("Cookie", f"rioku_session={session_id}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read()
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, json.loads(body) if body else {}

user_ids = {}
errors   = 0

for user in config["users"]:
    username = user["username"]
    payload  = {
        "username": username,
        "password": user["password"],
        "status":   user.get("status", "active"),
    }
    status, resp = api("POST", "/api/v1/users", payload)
    if status in (200, 201):
        uid = resp.get("id") or resp.get("user", {}).get("id", "")
        user_ids[username] = uid
        print(f"  created {username}: {uid}")

        # Assign roles.
        for role_name in user.get("roles", []):
            # Find role ID.
            _, roles_resp = api("GET", "/api/v1/roles")
            roles = roles_resp.get("roles", [])
            role_id = next((r["id"] for r in roles if r["name"] == role_name), None)
            if role_id:
                rs, _ = api("POST", f"/api/v1/users/{uid}/roles", {"role_id": role_id})
                if rs in (200, 201, 204):
                    print(f"    assigned role {role_name}")
                else:
                    print(f"    WARN: could not assign role {role_name} (HTTP {rs})")
            else:
                print(f"    WARN: role {role_name} not found — skipping")

        # Set status if not active (locked, suspended).
        final_status = user.get("status", "active")
        if final_status == "locked":
            api("POST", f"/api/v1/users/{uid}/lock", {})
            print(f"    locked {username}")
        elif final_status == "suspended":
            api("POST", f"/api/v1/users/{uid}/suspend", {})
            print(f"    suspended {username}")

    elif status == 409:
        print(f"  {username}: already exists (skipped)")
        # Try to get ID for state file.
        _, list_resp = api("GET", "/api/v1/users")
        for u in list_resp.get("users", []):
            if u.get("username") == username:
                user_ids[username] = u.get("id", "")
                break
    else:
        print(f"  WARN: {username}: HTTP {status} — {resp}")
        errors += 1

# Write state file.
import os
state = {"user_ids": user_ids}
os.makedirs(data_dir, exist_ok=True)
with open(f"{data_dir}/test-users-state.json", "w") as f:
    json.dump(state, f, indent=2)
print(f"\nState saved to {data_dir}/test-users-state.json")

if errors > 0:
    print(f"\nWARN: {errors} user(s) failed to create")
    sys.exit(1)
PYEOF

success "Test users seeded"

# --------------------------------------------------------------------------
# Step 4: Logout root session
# --------------------------------------------------------------------------
api POST /api/v1/auth/logout >/dev/null 2>&1 || true
rm -f "${COOKIE_JAR}"
success "Root session logged out"

echo ""
echo -e "${BOLD}Test users available:${NC}"
echo -e "  testadmin      / TestAdmin123!   (admin)"
echo -e "  testoperator   / TestOp123!      (operator)"
echo -e "  testviewer     / TestView123!    (viewer)"
echo -e "  testmulti      / TestMulti123!   (operator + auditor)"
echo -e "  test2fa        / Test2FA123!     (admin, TOTP setup required)"
echo -e "  testlocked     / TestLocked123!  (viewer, locked)"
echo -e "  testsuspended  / TestSusp123!    (viewer, suspended)"
echo ""
```

- [ ] **Step 2: Make executable**

```bash
chmod +x sandbox/scripts/seed-users.sh
```

---

## Task 3: Update `sandbox/scripts/start.sh`

Replace the bootstrap-token-based auth flow with username/password login. Add screen-based process management with fallback to background processes. Add test user seeding after init.

The changes are:

1. At top: detect `screen` availability, set `USE_SCREEN` flag.
2. Step 4: `start_app` function uses screen sessions if available, falls back to background processes.
3. Step 5 (daemon start): use screen session `rioku-daemon` if available.
4. Step 7 (seeding): replace token exchange + Bearer auth with cookie-based auth via `POST /api/v1/auth/login`.
5. New Step 8: seed test users by calling `seed-users.sh` with the root password.
6. Summary: update to mention screen sessions if in use.

- [ ] **Step 1: Replace `sandbox/scripts/start.sh` with the updated version**

Replace the entire file content:

```bash
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
if command -v screen >/dev/null 2>&1; then
  USE_SCREEN=true
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

ROOT_PASSWORD=""
if [[ ! -f "${DAEMON_CONFIG}" ]]; then
  info "Running 'rioku init' (non-interactive, sqlite store) ..."
  INIT_OUTPUT="$( "${DAEMON_BIN}" init \
    --config-file "${DAEMON_CONFIG}" \
    --data-dir    "${DATA_DIR}" \
    --store       sqlite \
    --listen      ":7778" \
    --non-interactive \
    2>&1 | tee -a "${DATA_DIR}/init.log" )"

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
    -d "{\"username\": \"root\", \"password\": \"${ROOT_PASSWORD}\"}" \
    "${REST_BASE}/api/v1/auth/login" 2>/dev/null || true)"

  if [[ -z "${LOGIN_RESP}" ]]; then
    warn "Root login failed — daemon may not be ready yet. Skipping seed."
    warn "Run 'make sandbox-seed-users' after daemon is healthy."
  else
    success "Root login successful"

    # Apply seed config.
    info "Seeding services, routes, and policies from ${SEED_FILE} ..."
    seed_failed=0
    python3 - <<'PYEOF' 2>/dev/null || seed_failed=1
import json, urllib.request, urllib.error, http.cookiejar, os

seed_file  = os.environ.get("SEED_FILE",   "")
rest_base  = os.environ.get("REST_BASE",   "http://localhost:7778")
cookie_jar = os.environ.get("COOKIE_JAR",  "")

# Read session cookie from the curl cookie jar file.
session_id = ""
if cookie_jar and os.path.exists(cookie_jar):
    with open(cookie_jar) as cf:
        for line in cf:
            if "rioku_session" in line:
                session_id = line.strip().split("\t")[-1]
                break

with open(seed_file) as f:
    seed = json.load(f)

def api(method, path, payload=None):
    url  = f"{rest_base}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req  = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if session_id:
        req.add_header("Cookie", f"rioku_session={session_id}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read()
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, json.loads(body) if body else {}

service_ids = {}
for svc in seed.get("services", []):
    change = {"service": {"action": "UPSERT", "service": {
        "name":      svc["name"],
        "upstreams": svc["upstreams"],
        "lbPolicy":  svc["lbPolicy"],
    }}}
    status, resp = api("POST", "/api/v1/config", change)
    svc_id = resp.get("id") or resp.get("service", {}).get("id", "")
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
    status, _ = api("POST", "/api/v1/config", {"route": {"action": "UPSERT", "route": r}})
    print(f"  route {route['name']}: HTTP {status}")

for pol in seed.get("policies", []):
    status, _ = api("POST", "/api/v1/config", {"policy": {"action": "UPSERT", "policy": {
        "name":   pol["name"],
        "type":   pol["type"],
        "config": pol.get("config", {}),
    }}})
    print(f"  policy {pol['name']}: HTTP {status}")
PYEOF
    export SEED_FILE REST_BASE COOKIE_JAR  # make env vars available to the heredoc python

    if (( seed_failed )); then
      warn "Config seed encountered errors (daemon API may not be fully implemented yet)"
    else
      success "Config seed complete"
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
```

**Key changes from original:**
- `USE_SCREEN` detection and `start_process` abstraction replaces direct `&` backgrounding
- `rioku init` root password captured instead of bootstrap token
- Auth changed from `POST /api/v1/auth/token` (Bearer) to `POST /api/v1/auth/login` (cookie)
- Config seed uses cookie jar (`-b`/`-c` flags) instead of `Authorization: Bearer`
- Step 8 calls `seed-users.sh` for test user seeding
- Summary updated to show screen session commands if applicable

---

## Task 4: Update `sandbox/scripts/stop.sh`

Add screen session cleanup. When screen is in use, `stop.sh` must quit screen sessions in addition to (or instead of) killing PIDs. PIDs in the PID file will be `0` for screen-managed processes.

- [ ] **Step 1: Replace `sandbox/scripts/stop.sh` with the updated version**

```bash
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
```

---

## Task 5: Create `sandbox/scripts/test-auth.sh`

Auth smoke tests via curl. Tests every significant auth path: happy path, role enforcement, logout, wrong password, locked account, suspended account, session revocation.

**Design principles:**
- Each test logs `[PASS]` or `[FAIL]` with the scenario name and HTTP status received.
- Script exits non-zero if any test fails.
- Uses a per-test cookie jar in a temp directory (cleaned up on exit).
- Tests are ordered: login tests before revocation (which requires two active sessions).

- [ ] **Step 1: Create `sandbox/scripts/test-auth.sh`**

```bash
#!/usr/bin/env bash
# sandbox/scripts/test-auth.sh — Auth smoke tests against a running sandbox.
# Exit 0 = all tests passed. Exit 1 = one or more tests failed.
# Usage: bash sandbox/scripts/test-auth.sh [base-url]
set -uo pipefail

BASE="${1:-http://localhost:7778}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
TMPDIR_COOKIES="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_COOKIES}"' EXIT

pass() { echo -e "${GREEN}[PASS]${NC} $*"; (( PASS++ )) || true; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; (( FAIL++ )) || true; }
info() { echo -e "${CYAN}[INFO]${NC} $*"; }

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
jar() { echo "${TMPDIR_COOKIES}/cookies-$1.txt"; }

# Login helper: returns HTTP status, saves session cookie.
# Usage: do_login <jar-id> <username> <password> [totp_code]
do_login() {
  local jar_id="$1" username="$2" password="$3" totp="${4:-}"
  local payload
  if [[ -n "${totp}" ]]; then
    payload="{\"username\":\"${username}\",\"password\":\"${password}\",\"totp_code\":\"${totp}\"}"
  else
    payload="{\"username\":\"${username}\",\"password\":\"${password}\"}"
  fi
  curl -s -o /dev/null -w "%{http_code}" \
    -c "$(jar "${jar_id}")" \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${BASE}/api/v1/auth/login"
}

# Authenticated GET using a cookie jar. Returns HTTP status.
do_get() {
  local jar_id="$1" path="$2"
  curl -s -o /dev/null -w "%{http_code}" \
    -b "$(jar "${jar_id}")" \
    "${BASE}${path}"
}

# Authenticated POST using a cookie jar. Returns HTTP status.
do_post() {
  local jar_id="$1" path="$2" data="${3:-{}}"
  curl -s -o /dev/null -w "%{http_code}" \
    -b "$(jar "${jar_id}")" -c "$(jar "${jar_id}")" \
    -H "Content-Type: application/json" \
    -d "${data}" \
    -X POST "${BASE}${path}"
}

# Logout using a cookie jar. Returns HTTP status.
do_logout() {
  local jar_id="$1"
  curl -s -o /dev/null -w "%{http_code}" \
    -b "$(jar "${jar_id}")" -c "$(jar "${jar_id}")" \
    -X POST "${BASE}/api/v1/auth/logout"
}

# Check cookie jar for presence of a session cookie.
has_cookie() {
  local jar_id="$1"
  grep -q "rioku_session" "$(jar "${jar_id}")" 2>/dev/null
}

echo ""
echo -e "${BOLD}=== Auth Smoke Tests ===${NC}"
echo -e "  Target: ${BASE}"
echo ""

# --------------------------------------------------------------------------
# 1. Login — happy paths (one per role)
# --------------------------------------------------------------------------
info "--- Login: happy paths ---"

for pair in "testadmin:TestAdmin123!" "testoperator:TestOp123!" "testviewer:TestView123!"; do
  user="${pair%%:*}"
  pass_="${pair##*:}"
  status="$(do_login "${user}" "${user}" "${pass_}")"
  if [[ "${status}" == "200" ]]; then
    if has_cookie "${user}"; then
      pass "login ${user}: HTTP 200, session cookie set"
    else
      fail "login ${user}: HTTP 200 but no session cookie in jar"
    fi
  else
    fail "login ${user}: expected 200, got ${status}"
  fi
done

# --------------------------------------------------------------------------
# 2. Access protected endpoint — 200 for authenticated user
# --------------------------------------------------------------------------
info "--- Protected endpoint: authenticated access ---"

status="$(do_get "testviewer" "/api/v1/auth/me")"
if [[ "${status}" == "200" ]]; then
  pass "GET /api/v1/auth/me as testviewer: 200"
else
  fail "GET /api/v1/auth/me as testviewer: expected 200, got ${status}"
fi

# --------------------------------------------------------------------------
# 3. RBAC enforcement — access beyond role scope → 403
# --------------------------------------------------------------------------
info "--- RBAC: access beyond role scope ---"

# viewer cannot POST /api/v1/users (requires users:create)
status="$(do_post "testviewer" "/api/v1/users" '{"username":"shouldfail","password":"Test1234!"}')"
if [[ "${status}" == "403" ]]; then
  pass "POST /api/v1/users as testviewer: 403 (correct — no users:create)"
else
  fail "POST /api/v1/users as testviewer: expected 403, got ${status}"
fi

# operator cannot GET /api/v1/users (requires users:read which operator doesn't have)
status="$(do_get "testoperator" "/api/v1/users")"
if [[ "${status}" == "403" ]]; then
  pass "GET /api/v1/users as testoperator: 403 (correct — no users:read)"
else
  fail "GET /api/v1/users as testoperator: expected 403, got ${status}"
fi

# --------------------------------------------------------------------------
# 4. Logout → cookie cleared → subsequent request → 401
# --------------------------------------------------------------------------
info "--- Logout flow ---"

# Login testviewer fresh for this test.
status="$(do_login "viewer-logout" "testviewer" "TestView123!")"
if [[ "${status}" != "200" ]]; then
  fail "Pre-logout login for testviewer: expected 200, got ${status}"
else
  # Verify auth works before logout.
  status="$(do_get "viewer-logout" "/api/v1/auth/me")"
  if [[ "${status}" != "200" ]]; then
    fail "Pre-logout GET /api/v1/auth/me: expected 200, got ${status}"
  else
    # Logout.
    status="$(do_logout "viewer-logout")"
    if [[ "${status}" == "200" ]] || [[ "${status}" == "204" ]]; then
      pass "POST /api/v1/auth/logout: HTTP ${status}"
    else
      fail "POST /api/v1/auth/logout: expected 200/204, got ${status}"
    fi

    # Check cookie cleared (rioku_session should not be in jar or should be expired).
    # curl updates the jar with the cleared cookie on logout.
    # Best-effort check: subsequent request should 401.
    status="$(do_get "viewer-logout" "/api/v1/auth/me")"
    if [[ "${status}" == "401" ]]; then
      pass "GET /api/v1/auth/me after logout: 401 (correct)"
    else
      fail "GET /api/v1/auth/me after logout: expected 401, got ${status}"
    fi
  fi
fi

# --------------------------------------------------------------------------
# 5. Wrong password → 401 (no cookie set)
# --------------------------------------------------------------------------
info "--- Wrong password ---"

status="$(do_login "badpass" "testviewer" "WrongPassword!")"
if [[ "${status}" == "401" ]]; then
  if ! has_cookie "badpass"; then
    pass "Login with wrong password: 401, no cookie set"
  else
    fail "Login with wrong password: got 401 but cookie was set (should not be)"
  fi
else
  fail "Login with wrong password: expected 401, got ${status}"
fi

# Non-existent user should also return 401 (same response as wrong password).
status="$(do_login "nouser" "doesnotexist" "WrongPassword!")"
if [[ "${status}" == "401" ]]; then
  pass "Login with non-existent user: 401 (timing-safe — same as wrong password)"
else
  fail "Login with non-existent user: expected 401, got ${status}"
fi

# --------------------------------------------------------------------------
# 6. Locked account → 423
# --------------------------------------------------------------------------
info "--- Locked account ---"

status="$(do_login "locked" "testlocked" "TestLocked123!")"
if [[ "${status}" == "423" ]]; then
  pass "Login locked account: 423"
else
  fail "Login locked account: expected 423, got ${status}"
fi

# --------------------------------------------------------------------------
# 7. Suspended account → 403
# --------------------------------------------------------------------------
info "--- Suspended account ---"

status="$(do_login "suspended" "testsuspended" "TestSusp123!")"
if [[ "${status}" == "403" ]]; then
  pass "Login suspended account: 403"
else
  fail "Login suspended account: expected 403, got ${status}"
fi

# --------------------------------------------------------------------------
# 8. Unauthenticated request → 401
# --------------------------------------------------------------------------
info "--- Unauthenticated request ---"

status="$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/api/v1/config")"
if [[ "${status}" == "401" ]]; then
  pass "GET /api/v1/config unauthenticated: 401"
else
  fail "GET /api/v1/config unauthenticated: expected 401, got ${status}"
fi

# --------------------------------------------------------------------------
# 9. Session revocation: admin revokes viewer session → viewer gets 401
# --------------------------------------------------------------------------
info "--- Session revocation ---"

# Login testviewer to get a session, then get its session ID.
do_login "victim" "testviewer" "TestView123!" >/dev/null
me_resp="$(curl -s -b "$(jar "victim")" "${BASE}/api/v1/auth/me" 2>/dev/null || true)"
victim_session_id="$(echo "${me_resp}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"

if [[ -z "${victim_session_id}" ]]; then
  fail "Session revocation: could not get testviewer session ID (GET /api/v1/auth/me may not include session.id)"
else
  # Login as testadmin (has sessions:manage permission).
  do_login "revoker" "testadmin" "TestAdmin123!" >/dev/null

  # Revoke testviewer's session.
  status="$(curl -s -o /dev/null -w "%{http_code}" \
    -b "$(jar "revoker")" \
    -X DELETE \
    "${BASE}/api/v1/sessions/${victim_session_id}")"

  if [[ "${status}" == "200" ]] || [[ "${status}" == "204" ]]; then
    pass "DELETE /api/v1/sessions/${victim_session_id} as testadmin: HTTP ${status}"

    # Verify testviewer is now 401.
    status="$(do_get "victim" "/api/v1/auth/me")"
    if [[ "${status}" == "401" ]]; then
      pass "GET /api/v1/auth/me after session revocation: 401 (correct)"
    else
      fail "GET /api/v1/auth/me after session revocation: expected 401, got ${status}"
    fi
  else
    fail "DELETE /api/v1/sessions/${victim_session_id}: expected 200/204, got ${status}"
  fi
fi

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=== Auth Smoke Test Results ===${NC}"
echo -e "  ${GREEN}Passed: ${PASS}${NC}"
if (( FAIL > 0 )); then
  echo -e "  ${RED}Failed: ${FAIL}${NC}"
  echo ""
  exit 1
else
  echo -e "  ${RED}Failed: 0${NC}"
  echo ""
  exit 0
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x sandbox/scripts/test-auth.sh
```

---

## Task 6: Create `sandbox/scripts/test-smoke.sh`

Full-stack smoke tests. Calls `test-auth.sh` first, then exercises config CRUD, service CRUD, policy CRUD, API key lifecycle, audit log, admin panel HTML, SSE events, and health endpoint.

- [ ] **Step 1: Create `sandbox/scripts/test-smoke.sh`**

```bash
#!/usr/bin/env bash
# sandbox/scripts/test-smoke.sh — Full-stack smoke tests against a running sandbox.
# Exit 0 = all tests passed. Exit 1 = one or more tests failed.
# Usage: bash sandbox/scripts/test-smoke.sh [base-url]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${1:-http://localhost:7778}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
TMPDIR_COOKIES="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_COOKIES}"' EXIT

pass() { echo -e "${GREEN}[PASS]${NC} $*"; (( PASS++ )) || true; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; (( FAIL++ )) || true; }
info() { echo -e "${CYAN}[INFO]${NC} $*"; }

jar()    { echo "${TMPDIR_COOKIES}/cookies-$1.txt"; }
api_get()  { curl -s -w "\n%{http_code}" -b "$(jar "admin")" "${BASE}${1}"; }
api_post() { curl -s -w "\n%{http_code}" -b "$(jar "admin")" -c "$(jar "admin")" \
               -H "Content-Type: application/json" -d "${2}" -X POST "${BASE}${1}"; }
api_delete() { curl -s -o /dev/null -w "%{http_code}" -b "$(jar "admin")" \
                 -X DELETE "${BASE}${1}"; }

http_status() { echo "${1}" | tail -1; }
http_body()   { echo "${1}" | head -n -1; }

echo ""
echo -e "${BOLD}=== Full-Stack Smoke Tests ===${NC}"
echo -e "  Target: ${BASE}"
echo ""

# --------------------------------------------------------------------------
# Part 1: Auth smoke tests (delegate to test-auth.sh)
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 1: Auth smoke tests ---${NC}"
if bash "${SCRIPT_DIR}/test-auth.sh" "${BASE}"; then
  pass "Auth smoke tests: all passed"
else
  fail "Auth smoke tests: one or more failed (see above)"
fi

# --------------------------------------------------------------------------
# Part 2: Establish admin session for remaining tests
# --------------------------------------------------------------------------
info "--- Establishing admin session ---"

login_status="$(curl -s -o /dev/null -w "%{http_code}" \
  -c "$(jar "admin")" \
  -H "Content-Type: application/json" \
  -d '{"username":"testadmin","password":"TestAdmin123!"}' \
  "${BASE}/api/v1/auth/login")"

if [[ "${login_status}" == "200" ]]; then
  pass "testadmin login for smoke tests: 200"
else
  fail "testadmin login for smoke tests: expected 200, got ${login_status} — aborting remaining tests"
  echo ""
  echo -e "${BOLD}=== Smoke Test Results ===${NC}"
  echo -e "  ${GREEN}Passed: ${PASS}${NC}"
  echo -e "  ${RED}Failed: ${FAIL}${NC}"
  exit 1
fi

# --------------------------------------------------------------------------
# Part 3: Health endpoint
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 3: Health endpoint ---${NC}"

resp="$(api_get "/api/v1/health")"
status="$(http_status "${resp}")"
body="$(http_body "${resp}")"

if [[ "${status}" == "200" ]]; then
  pass "GET /api/v1/health: 200"
  # Check for status: ok in body.
  if echo "${body}" | grep -qi '"ok"'; then
    pass "GET /api/v1/health: body contains ok status"
  else
    fail "GET /api/v1/health: body does not indicate ok status — got: ${body}"
  fi
else
  fail "GET /api/v1/health: expected 200, got ${status}"
fi

# --------------------------------------------------------------------------
# Part 4: Config CRUD — create route, verify proxy behavior
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 4: Config CRUD ---${NC}"

# Create a service.
resp="$(api_post "/api/v1/config" '{
  "service": {
    "action": "UPSERT",
    "service": {
      "name": "smoke-svc",
      "upstreams": [{"address": "localhost:9001"}],
      "lbPolicy": "round_robin"
    }
  }
}')"
status="$(http_status "${resp}")"
body="$(http_body "${resp}")"

if [[ "${status}" == "200" ]] || [[ "${status}" == "201" ]]; then
  pass "Create service smoke-svc: HTTP ${status}"
  SMOKE_SVC_ID="$(echo "${body}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
else
  fail "Create service smoke-svc: expected 200/201, got ${status}"
  SMOKE_SVC_ID=""
fi

# Create a route pointing to it.
if [[ -n "${SMOKE_SVC_ID}" ]]; then
  resp="$(api_post "/api/v1/config" "{
    \"route\": {
      \"action\": \"UPSERT\",
      \"route\": {
        \"name\": \"smoke-route\",
        \"enabled\": true,
        \"serviceId\": \"${SMOKE_SVC_ID}\",
        \"matchers\": [{\"type\": \"path_prefix\", \"value\": \"/smoke-test\"}]
      }
    }
  }")"
  status="$(http_status "${resp}")"
  if [[ "${status}" == "200" ]] || [[ "${status}" == "201" ]]; then
    pass "Create route smoke-route: HTTP ${status}"

    # Verify the route proxies to upstream (users-svc /health).
    proxy_status="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
      "${BASE}/smoke-test/health" 2>/dev/null || true)"
    if [[ "${proxy_status}" == "200" ]]; then
      pass "Proxy via smoke-route to users-svc: 200"
    else
      fail "Proxy via smoke-route to users-svc: expected 200, got ${proxy_status} (Caddy config may not have applied yet)"
    fi
  else
    fail "Create route smoke-route: expected 200/201, got ${status}"
  fi
else
  fail "Skipping route creation (no service ID)"
fi

# Read config back — verify smoke-svc appears.
resp="$(api_get "/api/v1/config")"
status="$(http_status "${resp}")"
body="$(http_body "${resp}")"
if [[ "${status}" == "200" ]]; then
  if echo "${body}" | grep -q "smoke-svc"; then
    pass "GET /api/v1/config: smoke-svc present in response"
  else
    fail "GET /api/v1/config: smoke-svc not found in response"
  fi
else
  fail "GET /api/v1/config: expected 200, got ${status}"
fi

# --------------------------------------------------------------------------
# Part 5: Policy CRUD
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 5: Policy CRUD ---${NC}"

resp="$(api_post "/api/v1/config" '{
  "policy": {
    "action": "UPSERT",
    "policy": {
      "name": "smoke-ratelimit",
      "type": "rate_limit",
      "config": {"requests_per_second": 100, "burst": 200}
    }
  }
}')"
status="$(http_status "${resp}")"
if [[ "${status}" == "200" ]] || [[ "${status}" == "201" ]]; then
  pass "Create policy smoke-ratelimit: HTTP ${status}"
else
  fail "Create policy smoke-ratelimit: expected 200/201, got ${status}"
fi

# --------------------------------------------------------------------------
# Part 6: API key lifecycle
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 6: API key lifecycle ---${NC}"

# Create key.
resp="$(api_post "/api/v1/keys" '{"name":"smoke-key","scopes":"config:read"}')"
status="$(http_status "${resp}")"
body="$(http_body "${resp}")"
if [[ "${status}" == "200" ]] || [[ "${status}" == "201" ]]; then
  RAW_KEY="$(echo "${body}" | grep -o '"key":"[^"]*"' | cut -d'"' -f4 || true)"
  KEY_ID="$(echo "${body}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
  pass "Create API key smoke-key: HTTP ${status}"

  if [[ -n "${RAW_KEY}" ]]; then
    # Use key — should work for config:read.
    key_status="$(curl -s -o /dev/null -w "%{http_code}" \
      -H "Authorization: Bearer ${RAW_KEY}" \
      "${BASE}/api/v1/config")"
    if [[ "${key_status}" == "200" ]]; then
      pass "Use API key for GET /api/v1/config: 200"
    else
      fail "Use API key for GET /api/v1/config: expected 200, got ${key_status}"
    fi

    # Revoke key.
    if [[ -n "${KEY_ID}" ]]; then
      revoke_status="$(api_delete "/api/v1/keys/${KEY_ID}")"
      if [[ "${revoke_status}" == "200" ]] || [[ "${revoke_status}" == "204" ]]; then
        pass "Revoke API key smoke-key: HTTP ${revoke_status}"

        # Verify rejected.
        rejected_status="$(curl -s -o /dev/null -w "%{http_code}" \
          -H "Authorization: Bearer ${RAW_KEY}" \
          "${BASE}/api/v1/config")"
        if [[ "${rejected_status}" == "401" ]]; then
          pass "Revoked API key rejected: 401"
        else
          fail "Revoked API key: expected 401, got ${rejected_status}"
        fi
      else
        fail "Revoke API key: expected 200/204, got ${revoke_status}"
      fi
    fi
  else
    fail "API key created but raw key not returned in response"
  fi
else
  fail "Create API key smoke-key: expected 200/201, got ${status}"
fi

# --------------------------------------------------------------------------
# Part 7: Audit log
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 7: Audit log ---${NC}"

resp="$(api_get "/api/v1/audit")"
status="$(http_status "${resp}")"
body="$(http_body "${resp}")"
if [[ "${status}" == "200" ]]; then
  pass "GET /api/v1/audit: 200"
  # Verify the smoke-svc creation appears in audit log.
  if echo "${body}" | grep -qi "smoke"; then
    pass "GET /api/v1/audit: recent mutation (smoke-svc) appears in log"
  else
    fail "GET /api/v1/audit: expected recent smoke-svc mutation in log, not found"
  fi
else
  fail "GET /api/v1/audit: expected 200, got ${status}"
fi

# --------------------------------------------------------------------------
# Part 8: Admin panel serves HTML
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 8: Admin panel HTML ---${NC}"

panel_resp="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/")"
if [[ "${panel_resp}" == "200" ]]; then
  pass "GET / (admin panel): 200"
else
  fail "GET / (admin panel): expected 200, got ${panel_resp}"
fi

# --------------------------------------------------------------------------
# Part 9: SSE event stream
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 9: SSE event stream ---${NC}"

# Connect to SSE, trigger a config change, verify at least one event arrives.
# Use curl with --max-time to limit SSE connection time.
SSE_OUTPUT="$(curl -s --max-time 5 \
  -b "$(jar "admin")" \
  -H "Accept: text/event-stream" \
  "${BASE}/api/v1/events" 2>/dev/null || true)"

if [[ -n "${SSE_OUTPUT}" ]]; then
  if echo "${SSE_OUTPUT}" | grep -q "data:"; then
    pass "SSE /api/v1/events: received event data"
  else
    fail "SSE /api/v1/events: connected but no 'data:' lines received — output: ${SSE_OUTPUT}"
  fi
else
  fail "SSE /api/v1/events: no response (endpoint may not exist yet)"
fi

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=== Smoke Test Results ===${NC}"
echo -e "  ${GREEN}Passed: ${PASS}${NC}"
if (( FAIL > 0 )); then
  echo -e "  ${RED}Failed: ${FAIL}${NC}"
  echo ""
  exit 1
else
  echo -e "  ${RED}Failed: 0${NC}"
  echo ""
  exit 0
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x sandbox/scripts/test-smoke.sh
```

---

## Task 7: Add Makefile targets

Add four new targets to the Makefile. All four are appended after the existing `sandbox-seed` target.

**File:** `Makefile`

- [ ] **Step 1: Update `.PHONY` declaration line to include new targets**

Find the current line:
```makefile
.PHONY: all build build-daemon build-daemon-lean build-service proto proto-lint test test-race lint lint-commit lint-spell clean web web-build web-embed hooks setup sandbox sandbox-stop sandbox-seed help
```

Replace with:
```makefile
.PHONY: all build build-daemon build-daemon-lean build-service proto proto-lint test test-race lint lint-commit lint-spell clean web web-build web-embed hooks setup sandbox sandbox-stop sandbox-seed sandbox-restart-daemon sandbox-test-auth sandbox-test-smoke sandbox-seed-users help
```

- [ ] **Step 2: Replace the `sandbox-seed` target block with the expanded version**

Find:
```makefile
## sandbox-seed: Re-seed sandbox configuration
sandbox-seed:
	@echo "Re-seeding not yet implemented (restart sandbox instead)"
```

Replace with:
```makefile
## sandbox-seed: Re-seed sandbox configuration
sandbox-seed:
	@echo "Re-seeding not yet implemented (restart sandbox instead)"

## sandbox-restart-daemon: Rebuild daemon + restart without touching upstream apps (~5s)
sandbox-restart-daemon: build-daemon
	@echo "==> Restarting daemon screen session..."
	@if command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -q "rioku-daemon"; then \
	  screen -S rioku-daemon -X quit 2>/dev/null || true; \
	  sleep 1; \
	  screen -dmS rioku-daemon -L -Logfile sandbox/.data/daemon.log \
	    bin/rioku start --config-file sandbox/.data/rioku.yaml; \
	  echo "  daemon restarted in screen session rioku-daemon"; \
	else \
	  echo "  screen not found or rioku-daemon session not running"; \
	  echo "  stop and restart the sandbox with: make sandbox-stop && make sandbox"; \
	  exit 1; \
	fi
	@echo "==> Waiting for daemon health..."
	@for i in $$(seq 1 15); do \
	  if curl -sf --max-time 2 http://localhost:7778/api/v1/health >/dev/null 2>&1; then \
	    echo "[OK]    daemon is healthy"; \
	    exit 0; \
	  fi; \
	  sleep 1; \
	done; \
	echo "[WARN]  daemon did not become healthy in 15s — check sandbox/.data/daemon.log"

## sandbox-test-auth: Run auth smoke tests against running sandbox
sandbox-test-auth:
	@bash sandbox/scripts/test-auth.sh

## sandbox-test-smoke: Run full-stack smoke tests against running sandbox
sandbox-test-smoke:
	@bash sandbox/scripts/test-smoke.sh

## sandbox-seed-users: Seed test users into a running sandbox
sandbox-seed-users:
	@if [[ -f sandbox/.data/root-password ]]; then \
	  bash sandbox/scripts/seed-users.sh "$$(cat sandbox/.data/root-password)"; \
	else \
	  echo "[FAIL]  sandbox/.data/root-password not found"; \
	  echo "        Run: bash sandbox/scripts/seed-users.sh <root-password>"; \
	  exit 1; \
	fi
```

---

## Task 8: Verify — test commands

These commands confirm each new piece works after implementation.

- [ ] **Verify `sandbox/config/test-users.json` is valid JSON**

```bash
python3 -m json.tool sandbox/config/test-users.json >/dev/null && echo "JSON valid"
```

- [ ] **Verify `seed-users.sh` is executable and has valid bash syntax**

```bash
bash -n sandbox/scripts/seed-users.sh && echo "Syntax OK"
```

- [ ] **Verify `test-auth.sh` is executable and has valid bash syntax**

```bash
bash -n sandbox/scripts/test-auth.sh && echo "Syntax OK"
```

- [ ] **Verify `test-smoke.sh` is executable and has valid bash syntax**

```bash
bash -n sandbox/scripts/test-smoke.sh && echo "Syntax OK"
```

- [ ] **Verify `start.sh` has valid bash syntax**

```bash
bash -n sandbox/scripts/start.sh && echo "Syntax OK"
```

- [ ] **Verify `stop.sh` has valid bash syntax**

```bash
bash -n sandbox/scripts/stop.sh && echo "Syntax OK"
```

- [ ] **Verify Makefile targets are registered**

```bash
make help | grep sandbox
```

Expected output includes: `sandbox-restart-daemon`, `sandbox-test-auth`, `sandbox-test-smoke`, `sandbox-seed-users`.

- [ ] **Full integration verification (requires sandbox running with Plan 1 + Plan 2 complete)**

```bash
# Start sandbox.
make sandbox

# Verify screen sessions are running (Linux/macOS with screen installed).
screen -ls | grep rioku

# Run auth tests.
make sandbox-test-auth

# Run full smoke tests.
make sandbox-test-smoke

# Test daemon restart cycle.
# (Edit a source file, then):
make sandbox-restart-daemon
# Daemon should be back up within ~5 seconds.

# Re-seed users manually (idempotent).
make sandbox-seed-users

# Stop.
make sandbox-stop
# Verify all screen sessions are gone.
screen -ls | grep rioku || echo "All rioku sessions stopped"
```

---

## Commit Sequence

Each commit covers one logical unit. Staged per-file.

```
chore(sandbox): add test-users.json seed config

feat(sandbox): add seed-users.sh for test user provisioning

feat(sandbox): update start.sh — screen process management, cookie auth, user seeding

fix(sandbox): update stop.sh — quit screen sessions on shutdown

feat(sandbox): add test-auth.sh smoke test script

feat(sandbox): add test-smoke.sh full-stack smoke test script

feat(sandbox): add sandbox-restart-daemon, sandbox-test-auth, sandbox-test-smoke, sandbox-seed-users make targets
```

---

## Notes and Edge Cases

**screen not available:** All scripts gracefully fall back to background processes when screen is not installed. `sandbox-restart-daemon` exits with an error if screen is not in use (there is no safe way to restart only the daemon without screen sessions — the developer must do a full `sandbox-stop` + `sandbox` cycle instead).

**TOTP user (`test2fa`):** The smoke test does not test the TOTP login flow because enabling TOTP requires a multi-step setup flow that generates a time-based code. The `test2fa` user is seeded without TOTP enabled. A developer wanting to manually test the TOTP flow can enable it via `POST /api/v1/auth/totp/setup` after logging in as `test2fa`.

**`testmulti` auditor role:** The `auditor` custom role is created by `seed-users.sh` if it does not already exist. The role has no extra permissions beyond what is seeded — it exists only to verify multi-role assignment works correctly.

**Idempotency:** `seed-users.sh` handles HTTP 409 (user already exists) gracefully and skips without error. `sandbox-restart-daemon` kills the existing screen session before starting a new one. Both scripts are safe to run multiple times.

**CI usage:** `make sandbox-test-smoke` is the CI entry point. It delegates to `test-auth.sh` internally, so both auth and full-stack tests run in a single CI step.

**Timing:** The `sandbox-restart-daemon` health check polls for up to 15 seconds with 1-second intervals. The daemon typically starts in 1-2 seconds after binary rebuild.
