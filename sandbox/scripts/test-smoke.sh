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
