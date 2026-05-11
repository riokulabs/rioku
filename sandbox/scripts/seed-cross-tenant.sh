#!/usr/bin/env bash
# sandbox/scripts/seed-cross-tenant.sh
#
# Populate the non-default tenants (acme, beta) with the minimum seed data
# the Playwright e2e specs expect. The daemon's primary seed flow
# (`rioku seed --dir sandbox/seed`) only writes to the `default` tenant
# for the stage-1 resource types (services, routes, roles, api-keys,
# policies, rbac-policies, access-policies); the stage-2 SPA tests target
# `/t/acme/*` URLs and assume those tenants are populated too.
#
# This script runs AFTER the daemon seed completes (invoked from
# `seed-config.sh`) and uses the daemon's tenant-scoped REST endpoints to
# create a small but representative set of resources in each non-default
# tenant. Idempotent: collisions on `name` (409 Conflict) are silently
# skipped so re-running against an already-seeded sandbox is safe.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DATA_DIR="${REPO_ROOT}/sandbox/.data"
BASE="${1:-http://localhost:${SANDBOX_PORT_REST:-7778}}"
COOKIE_JAR="${DATA_DIR}/.cross-tenant-cookies"

# Tenants to populate. `default` is excluded — the legacy seed already
# covers it.
TENANTS=(acme beta)

# ANSI
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

# --- prerequisites ---
[[ -f "${DATA_DIR}/root-password" ]] || fail "root-password missing — is the sandbox running?"
ROOT_PASSWORD="$(cat "${DATA_DIR}/root-password")"

# --- login ---
info "Logging in as root for cross-tenant seed..."
rm -f "${COOKIE_JAR}"
LOGIN_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -c "${COOKIE_JAR}" \
    -X POST "${BASE}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"root\",\"password\":\"${ROOT_PASSWORD}\"}")
[[ "${LOGIN_STATUS}" == "200" ]] || fail "login returned HTTP ${LOGIN_STATUS}"
ok "Logged in"

# --- helpers ---
# POST a JSON body to a tenant-scoped path. Returns the HTTP status code
# on stdout; the response body (if any) on file descriptor 3 → /tmp.
tpost() {
    local tenant=$1
    local path=$2
    local body=$3
    local outfile
    outfile=$(mktemp)
    local status
    status=$(curl -sS -o "${outfile}" -w "%{http_code}" \
        -b "${COOKIE_JAR}" \
        -X POST "${BASE}/api/v1/t/${tenant}${path}" \
        -H "Content-Type: application/json" \
        -d "${body}")
    cat "${outfile}"
    rm -f "${outfile}"
    echo "$status"
}

# POST a JSON body to a non-tenant-scoped path.
gpost() {
    local path=$1
    local body=$2
    local outfile
    outfile=$(mktemp)
    local status
    status=$(curl -sS -o "${outfile}" -w "%{http_code}" \
        -b "${COOKIE_JAR}" \
        -X POST "${BASE}${path}" \
        -H "Content-Type: application/json" \
        -d "${body}")
    cat "${outfile}"
    rm -f "${outfile}"
    echo "$status"
}

# Quietly POST and only emit on unexpected non-success. 409 is treated as
# success (idempotent re-seed).
quiet_post() {
    local tenant=$1
    local path=$2
    local body=$3
    local label=$4
    local result status
    result=$(tpost "${tenant}" "${path}" "${body}")
    status=$(tail -n1 <<<"${result}")
    case "${status}" in
        2*) : ;;
        409) info "  ${label}: already exists (skip)" ;;
        *) warn "  ${label}: HTTP ${status}" ;;
    esac
}

# Extract a JSON field from response body lines (excludes the trailing status code).
# Usage: extract_field "$result" "id"
extract_field() {
    local raw=$1 field=$2
    # strip trailing status line
    local body
    body=$(head -n -1 <<<"${raw}")
    python3 -c "
import sys, json, re
raw = '''$body'''
try:
    d = json.loads(re.sub(r'[\x00-\x1f]', '', raw))
    print(d.get('${field}', ''))
except Exception:
    print('')
"
}

# ---------------------------------------------------------------------------
# Per-tenant seeding
# ---------------------------------------------------------------------------
for TENANT in "${TENANTS[@]}"; do
    info "==> Seeding tenant '${TENANT}'..."

    # --- services (need ≥5 for tests; routes will reference these) ---
    SVC_IDS=()
    for i in $(seq 1 8); do
        name="${TENANT}-svc-${i}"
        result=$(tpost "${TENANT}" "/services" "{
            \"name\":\"${name}\",
            \"upstreams\":[{\"address\":\"upstream-${i}.example.com:8080\",\"weight\":1}]
        }")
        status=$(tail -n1 <<<"${result}")
        if [[ "${status}" =~ ^2 ]]; then
            id=$(extract_field "${result}" "id")
            SVC_IDS+=("${id}")
        elif [[ "${status}" == "409" ]]; then
            info "  service ${name}: already exists (skip)"
        else
            warn "  service ${name}: HTTP ${status}"
        fi
    done
    ok "  services: ${#SVC_IDS[@]} created"

    # --- routes (need ≥10; 2 per service × ~6 services = 12) ---
    routes_created=0
    for svc_id in "${SVC_IDS[@]}"; do
        for j in 1 2; do
            route_name="${TENANT}-route-${svc_id:0:8}-${j}"
            quiet_post "${TENANT}" "/routes" "{
                \"name\":\"${route_name}\",
                \"serviceId\":\"${svc_id}\",
                \"matchers\":[{
                    \"hosts\":[\"${TENANT}-api.local\"],
                    \"paths\":[{\"type\":\"prefix\",\"value\":\"/v${j}/\"}],
                    \"methods\":[\"GET\",\"POST\"]
                }]
            }" "route ${route_name}"
            routes_created=$((routes_created + 1))
        done
    done
    ok "  routes: ~${routes_created} attempted"

    # --- middlewares (need ≥2) ---
    for kind in rate-limit cors logging; do
        quiet_post "${TENANT}" "/middlewares" "{
            \"name\":\"${TENANT}-mw-${kind}\",
            \"kind\":\"${kind}\",
            \"config\":{}
        }" "middleware ${kind}"
    done

    # --- AI providers (≥1) ---
    PROV_ID=""
    result=$(tpost "${TENANT}" "/ai/providers" "{
        \"name\":\"${TENANT}-openai\",
        \"kind\":\"openai\",
        \"baseUrl\":\"https://api.openai.com\"
    }")
    status=$(tail -n1 <<<"${result}")
    if [[ "${status}" =~ ^2 ]]; then
        PROV_ID=$(extract_field "${result}" "id")
        ok "  ai-provider created"
    else
        info "  ai-provider: HTTP ${status}"
    fi

    # --- AI agent (≥1, needs provider) ---
    if [[ -n "${PROV_ID}" ]]; then
        quiet_post "${TENANT}" "/ai/agents" "{
            \"name\":\"${TENANT}-support\",
            \"providerId\":\"${PROV_ID}\",
            \"model\":\"gpt-4o\",
            \"description\":\"Support assistant\",
            \"systemPrompt\":\"Be helpful.\"
        }" "ai-agent"
    fi

    # --- AI tools (≥1) ---
    quiet_post "${TENANT}" "/ai/tools" "{
        \"name\":\"${TENANT}-web-search\",
        \"kind\":\"http\",
        \"description\":\"Web search\",
        \"httpEndpoint\":\"https://example.com/search\",
        \"schema\":{\"type\":\"object\"}
    }" "ai-tool"

    # --- AI rate-limit (≥1) ---
    quiet_post "${TENANT}" "/ai/rate-limits" "{
        \"name\":\"${TENANT}-basic-limit\",
        \"scope\":\"tenant\",
        \"requestsPerMinute\":60,
        \"tokensPerMinute\":10000
    }" "ai-rate-limit"

    # --- AI MCP servers (≥1) ---
    # The daemon expects `url` + `authKind`, not `endpoint`/`transport`.
    quiet_post "${TENANT}" "/ai/mcp-servers" "{
        \"name\":\"${TENANT}-mcp-fs\",
        \"url\":\"https://mcp.example.com\",
        \"authKind\":\"none\"
    }" "ai-mcp-server"

    # --- roles (≥1) — path is /t/{tenant}/roles (no /security/ prefix) ---
    quiet_post "${TENANT}" "/roles" "{
        \"name\":\"${TENANT}-viewer\",
        \"description\":\"Read-only access\",
        \"permissions\":[\"audit:read\"]
    }" "role viewer"

    # --- api-keys (≥1) — daemon's keyCreateRequest treats `scopes` as a
    # comma-separated string, not an array (see key_routes.go:64-68).
    quiet_post "${TENANT}" "/api-keys" "{
        \"name\":\"${TENANT}-test-key\",
        \"scopes\":\"audit:read\"
    }" "api-key"

    # --- access-policies (≥1) — daemon requires effect (allow|deny) and
    # targetType (roles|users|all).
    quiet_post "${TENANT}" "/access-policies" "{
        \"name\":\"${TENANT}-default-policy\",
        \"description\":\"Default access policy\",
        \"effect\":\"allow\",
        \"targetType\":\"all\"
    }" "access-policy"

    # --- rbac-policies (≥1) — daemon requires name, subjectType,
    # subjectId, and roleId. Bind the test role to all users.
    role_result=$(curl -sS -b "${COOKIE_JAR}" \
        "${BASE}/api/v1/t/${TENANT}/roles")
    role_id=$(python3 -c "
import sys, json, re
try:
    raw = re.sub(r'[\x00-\x1f]', '', '''${role_result}''')
    d = json.loads(raw)
    # Roles endpoint returns either a bare array or {items: [...]}
    items = d if isinstance(d, list) else d.get('items', [])
    for r in items:
        if r.get('name') == '${TENANT}-viewer':
            print(r.get('id', ''))
            break
except Exception:
    pass
" 2>/dev/null || echo "")
    if [[ -n "${role_id}" ]]; then
        quiet_post "${TENANT}" "/rbac-policies" "{
            \"name\":\"${TENANT}-default-rbac\",
            \"description\":\"Default RBAC policy\",
            \"subjectType\":\"role\",
            \"subjectId\":\"${role_id}\",
            \"roleId\":\"${role_id}\"
        }" "rbac-policy"
    else
        warn "  rbac-policy: skipped (no ${TENANT}-viewer role)"
    fi

    # --- notification channels (≥1) ---
    quiet_post "${TENANT}" "/notification-channels" "{
        \"name\":\"${TENANT}-ops-slack\",
        \"kind\":\"slack\",
        \"config\":{\"webhookUrl\":\"https://hooks.slack.example.com/${TENANT}\"}
    }" "notif-channel"

    ok "==> Tenant '${TENANT}' seeded"
done

rm -f "${COOKIE_JAR}"
ok "Cross-tenant seed complete"
