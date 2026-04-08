#!/usr/bin/env bash
# sandbox/scripts/seed-config.sh — Seed configuration into a running Rioku instance.
# Extracted from start.sh Step 7 so it can be called independently via `make sandbox-seed`.
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

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SANDBOX_DIR="${REPO_ROOT}/sandbox"
DATA_DIR="${SANDBOX_DIR}/.data"
SEED_FILE="${SANDBOX_DIR}/config/seed.json"
API_KEYS_FILE="${SANDBOX_DIR}/config/api-keys.json"
REST_BASE="${1:-http://localhost:7778}"
COOKIE_JAR="${DATA_DIR}/seed-cookies.txt"

# --------------------------------------------------------------------------
# Validate prerequisites
# --------------------------------------------------------------------------
if [[ ! -f "${DATA_DIR}/root-password" ]]; then
    echo -e "${RED}[FAIL]${NC}  ${DATA_DIR}/root-password not found"
    echo "        Is the sandbox running? Start it with: make sandbox"
    exit 1
fi

ROOT_PASSWORD="$(cat "${DATA_DIR}/root-password")"

if [[ -z "${ROOT_PASSWORD}" ]]; then
    echo -e "${RED}[FAIL]${NC}  root-password file is empty"
    exit 1
fi

if [[ ! -f "${SEED_FILE}" ]]; then
    echo -e "${RED}[FAIL]${NC}  Seed file not found: ${SEED_FILE}"
    exit 1
fi

# --------------------------------------------------------------------------
# Login as root to get a session cookie
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Seeding configuration${NC}"

info "Logging in as root for config seeding..."
LOGIN_RESP="$(curl -sf --max-time 10 \
    -c "${COOKIE_JAR}" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"root\", \"password\": \"${ROOT_PASSWORD}\"}" \
    "${REST_BASE}/api/v1/auth/login" 2>/dev/null || true)"

if [[ -z "${LOGIN_RESP}" ]]; then
    echo -e "${RED}[FAIL]${NC}  Root login failed — is the daemon running and healthy?"
    echo "        Check: curl -sf ${REST_BASE}/api/v1/health"
    rm -f "${COOKIE_JAR}"
    exit 1
fi

success "Root login successful"

# --------------------------------------------------------------------------
# Apply seed config (services, routes, policies)
# --------------------------------------------------------------------------
info "Seeding services, routes, and policies from ${SEED_FILE} ..."
seed_failed=0
export SEED_FILE REST_BASE COOKIE_JAR
python3 - <<'PYEOF' 2>/dev/null || seed_failed=1
import json, urllib.request, urllib.error, os

seed_file  = os.environ.get("SEED_FILE",   "")
rest_base  = os.environ.get("REST_BASE",   "http://localhost:7778")
cookie_jar = os.environ.get("COOKIE_JAR",  "")

# Read session cookie from the curl cookie jar file.
session_id = ""
if cookie_jar and os.path.exists(cookie_jar):
    with open(cookie_jar) as cf:
        for line in cf:
            if "rioku_sid" in line:
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
        req.add_header("Cookie", f"rioku_sid={session_id}")
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

if (( seed_failed )); then
    warn "Config seed encountered errors (daemon API may not be fully implemented yet)"
else
    success "Config seed complete"
fi

# --------------------------------------------------------------------------
# Create API keys
# --------------------------------------------------------------------------
if [[ -f "${API_KEYS_FILE}" ]]; then
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
fi

# --------------------------------------------------------------------------
# Logout root session used for seeding
# --------------------------------------------------------------------------
curl -sf --max-time 5 -b "${COOKIE_JAR}" \
    -X POST "${REST_BASE}/api/v1/auth/logout" >/dev/null 2>&1 || true
rm -f "${COOKIE_JAR}"
success "Root seeding session closed"

echo ""
echo -e "${BOLD}Config seeding complete.${NC}"
echo ""
