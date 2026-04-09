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

for pair in "testadmin:TestAdmin123!" "testoperator:TestOperator123!" "testviewer:TestView123!"; do
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
# 3. RBAC enforcement — access beyond role scope -> 403
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
# 4. Logout -> cookie cleared -> subsequent request -> 401
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
# 5. Wrong password -> 401 (no cookie set)
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
# 6. Locked account -> 423
# --------------------------------------------------------------------------
info "--- Locked account ---"

status="$(do_login "locked" "testlocked" "TestLocked123!")"
if [[ "${status}" == "423" ]]; then
  pass "Login locked account: 423"
else
  fail "Login locked account: expected 423, got ${status}"
fi

# --------------------------------------------------------------------------
# 7. Suspended account -> 403
# --------------------------------------------------------------------------
info "--- Suspended account ---"

status="$(do_login "suspended" "testsuspended" "TestSusp123!")"
if [[ "${status}" == "403" ]]; then
  pass "Login suspended account: 403"
else
  fail "Login suspended account: expected 403, got ${status}"
fi

# --------------------------------------------------------------------------
# 8. Unauthenticated request -> 401
# --------------------------------------------------------------------------
info "--- Unauthenticated request ---"

status="$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/api/v1/config")"
if [[ "${status}" == "401" ]]; then
  pass "GET /api/v1/config unauthenticated: 401"
else
  fail "GET /api/v1/config unauthenticated: expected 401, got ${status}"
fi

# --------------------------------------------------------------------------
# 9. Session revocation: admin revokes viewer session -> viewer gets 401
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
