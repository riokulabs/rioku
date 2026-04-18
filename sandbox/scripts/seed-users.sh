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

# --------------------------------------------------------------------------
# Load environment config
# --------------------------------------------------------------------------
ENV_FILE="${SANDBOX_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi
: "${SANDBOX_PORT_REST:=7778}"

# --------------------------------------------------------------------------
# Derived paths and addresses
# --------------------------------------------------------------------------
DATA_DIR="${SANDBOX_DIR}/.data"
TEST_USERS_FILE="${SANDBOX_DIR}/config/test-users.json"
STATE_FILE="${DATA_DIR}/test-users-state.json"
REST_BASE="http://localhost:${SANDBOX_PORT_REST}"
COOKIE_JAR="${DATA_DIR}/seed-cookies.txt"

# --------------------------------------------------------------------------
# Dependency checks
# --------------------------------------------------------------------------
for cmd in curl python3; do
  command -v "${cmd}" >/dev/null 2>&1 || die "Required tool '${cmd}' not found. Install it and try again."
done

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
SEED_UA="rioku-seed-script/1.0"
login_resp="$(curl -s --max-time 10 \
  -c "${COOKIE_JAR}" \
  -w "\nHTTP_CODE:%{http_code}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: ${SEED_UA}" \
  -d "{\"username\": \"root\", \"password\": \"${ROOT_PASSWORD}\"}" \
  "${REST_BASE}/api/v1/auth/login" 2>&1)" || \
  die "Login failed — curl error"

http_code="$(echo "${login_resp}" | grep 'HTTP_CODE:' | cut -d: -f2)"
login_body="$(echo "${login_resp}" | grep -v 'HTTP_CODE:')"

if [[ "${http_code}" != "200" ]]; then
  die "Root login failed: HTTP ${http_code} — ${login_body}"
fi

success "Root login successful (HTTP ${http_code})"

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

export TEST_USERS_FILE REST_BASE ROOT_PASSWORD DATA_DIR SEED_UA

python3 - <<'PYEOF'
import json, os, sys, urllib.request, urllib.error

test_users_file = os.environ["TEST_USERS_FILE"]
rest_base       = os.environ["REST_BASE"]
root_password   = os.environ["ROOT_PASSWORD"]
data_dir        = os.environ["DATA_DIR"]
seed_ua         = os.environ.get("SEED_UA", "rioku-seed-script/1.0")

with open(test_users_file) as f:
    config = json.load(f)

# Login via python (not curl) to reliably capture the session cookie.
login_data = json.dumps({"username": "root", "password": root_password}).encode()
login_req = urllib.request.Request(f"{rest_base}/api/v1/auth/login", data=login_data, method="POST")
login_req.add_header("Content-Type", "application/json")
login_req.add_header("User-Agent", seed_ua)
try:
    login_resp = urllib.request.urlopen(login_req, timeout=10)
except urllib.error.HTTPError as e:
    print(f"  FATAL: root login failed: HTTP {e.code} — {e.read().decode()}", file=sys.stderr)
    sys.exit(1)

# Extract session cookie from response headers.
session_id = ""
for header in login_resp.headers.get_all("Set-Cookie") or []:
    for part in header.split(";"):
        part = part.strip()
        if part.startswith("rioku_sid="):
            session_id = part.split("=", 1)[1]
            break
    if session_id:
        break

if not session_id:
    print(f"  FATAL: login succeeded but no rioku_sid cookie in response", file=sys.stderr)
    print(f"  Set-Cookie headers: {login_resp.headers.get_all('Set-Cookie')}", file=sys.stderr)
    sys.exit(1)

def api(method, path, payload=None):
    url = f"{rest_base}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", seed_ua)
    req.add_header("Cookie", f"rioku_sid={session_id}")
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
        "forcePasswordChange": False,
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
            roles = roles_resp if isinstance(roles_resp, list) else roles_resp.get("roles", [])
            role_id = next((r["id"] for r in roles if r["name"] == role_name), None)
            if role_id:
                rs, _ = api("POST", f"/api/v1/users/{uid}/roles", {"roleId": role_id})
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
        users_list = list_resp if isinstance(list_resp, list) else list_resp.get("users", [])
        for u in users_list:
            if u.get("username") == username:
                user_ids[username] = u.get("id", "")
                break
    else:
        print(f"  WARN: {username}: HTTP {status} — {resp}")
        errors += 1

# Write state file.
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
echo -e "  testoperator   / TestOperator123!      (operator)"
echo -e "  testviewer     / TestView123!    (viewer)"
echo -e "  testmulti      / TestMulti123!   (operator + auditor)"
echo -e "  test2fa        / Test2Factor123!     (admin, TOTP setup required)"
echo -e "  testlocked     / TestLocked123!  (viewer, locked)"
echo -e "  testsuspended  / TestSusp123!    (viewer, suspended)"
echo ""
