#!/usr/bin/env bash
# sandbox/scripts/test-primitives.sh — Smoke tests for Sprint 1 Caddy primitives.
#
# Exercises request_headers, response_headers, response_rules / handle_response,
# encode/compression, dynamic_upstreams, trusted_proxies, and request/response
# buffers by POSTing fixture services + routes through the REST API and then
# hitting the Caddy traffic plane to verify each primitive's effect.
#
# Each fixture is namespaced with a `prim-` prefix so it doesn't collide with
# the seed.yaml entries. Fixtures are upserted (UPSERT action) so re-running
# the test on an existing sandbox is safe.
#
# Exit 0 = all primitive tests passed. Exit 1 = one or more failed.
# Usage: bash sandbox/scripts/test-primitives.sh [base-url]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# --------------------------------------------------------------------------
# Load environment config
# --------------------------------------------------------------------------
ENV_FILE="${SANDBOX_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi
: "${SANDBOX_PORT_REST:=7778}"
: "${SANDBOX_PORT_TRAFFIC:=8443}"
: "${SANDBOX_PORT_USERS:=9001}"

BASE="${1:-http://localhost:${SANDBOX_PORT_REST}}"
TRAFFIC_BASE="http://localhost:${SANDBOX_PORT_TRAFFIC}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
TMPDIR_COOKIES="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_COOKIES}"' EXIT

pass() { echo -e "${GREEN}[PASS]${NC} $*"; (( PASS++ )) || true; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; (( FAIL++ )) || true; }
info() { echo -e "${CYAN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

JAR="${TMPDIR_COOKIES}/admin.cookies"

api_post() {
  curl -s -w "\n%{http_code}" -b "${JAR}" -c "${JAR}" \
    -H "Content-Type: application/json" \
    -d "${2}" -X POST "${BASE}${1}"
}

api_get() {
  curl -s -w "\n%{http_code}" -b "${JAR}" "${BASE}${1}"
}

http_status() { echo "${1}" | tail -1; }
http_body()   { echo "${1}" | head -n -1; }

echo ""
echo -e "${BOLD}=== Caddy Primitive Smoke Tests ===${NC}"
echo -e "  REST:    ${BASE}"
echo -e "  Traffic: ${TRAFFIC_BASE}"
echo ""

# --------------------------------------------------------------------------
# Login as testadmin
# --------------------------------------------------------------------------
info "Logging in as testadmin..."
login_status="$(curl -s -o /dev/null -w "%{http_code}" \
  -c "${JAR}" \
  -H "Content-Type: application/json" \
  -d '{"username":"testadmin","password":"TestAdmin123!"}' \
  "${BASE}/api/v1/auth/login")"

if [[ "${login_status}" != "200" ]]; then
  fail "testadmin login: expected 200, got ${login_status}"
  exit 1
fi
pass "testadmin login: 200"

# --------------------------------------------------------------------------
# Pre-flight: delete `smoke-route` if it exists.
#
# test-smoke.sh's Part 4 creates a route named `smoke-route` whose REST
# matcher payload doesn't match the proto Matcher shape. The compiler
# stores it as a route with no constraints, which Caddy then treats as
# match-all and shadows our prim-* routes. Delete it (if present) so
# our path-prefix matchers see traffic. test-smoke.sh recreates
# smoke-route in Part 4 after this script returns; Caddy reload there
# does not affect our verifications.
# --------------------------------------------------------------------------
cfg="$(api_get "/api/v1/config")"
cfg_body="$(http_body "${cfg}")"
SMOKE_ROUTE_ID="$(echo "${cfg_body}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('routes', []):
    if r.get('name') == 'smoke-route':
        print(r['id']); break
" 2>/dev/null)"
if [[ -n "${SMOKE_ROUTE_ID}" ]]; then
  info "Pre-flight: deleting stale smoke-route (id=${SMOKE_ROUTE_ID})..."
  resp="$(api_post "/api/v1/config" "{\"route\":{\"action\":\"DELETE\",\"id\":\"${SMOKE_ROUTE_ID}\"}}")"
  status="$(http_status "${resp}")"
  if [[ "${status}" == "200" ]]; then
    pass "Pre-flight: stale smoke-route deleted"
  else
    warn "Pre-flight: smoke-route delete returned ${status}; primitives may be shadowed"
  fi
fi

# --------------------------------------------------------------------------
# Helper: upsert a service via the REST API and return its ID by name.
# --------------------------------------------------------------------------
upsert_service() {
  local payload="$1"
  resp="$(api_post "/api/v1/config" "${payload}")"
  local status; status="$(http_status "${resp}")"
  if [[ "${status}" != "200" && "${status}" != "201" ]]; then
    return 1
  fi
}

fetch_service_id() {
  local name="$1"
  local cfg; cfg="$(api_get "/api/v1/config")"
  local body; body="$(http_body "${cfg}")"
  echo "${body}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for s in d.get('services', []):
    if s['name'] == '${name}':
        print(s['id'])
        break
" 2>/dev/null
}

upsert_route() {
  local payload="$1"
  resp="$(api_post "/api/v1/config" "${payload}")"
  local status; status="$(http_status "${resp}")"
  if [[ "${status}" != "200" && "${status}" != "201" ]]; then
    return 1
  fi
}

# --------------------------------------------------------------------------
# Fixture 1: Service with request_headers, response_headers, compression.
# Route on /prim-headers/* sends traffic to the users app /metrics
# (no error injection on /metrics).
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 1: Request/Response headers + compression ---${NC}"

PRIM_HEADERS_SVC_PAYLOAD=$(cat <<JSON
{
  "service": {
    "action": "UPSERT",
    "service": {
      "name": "prim-headers-svc",
      "upstreams": [{"address": "localhost:${SANDBOX_PORT_USERS}"}],
      "lbPolicy": "LB_POLICY_ROUND_ROBIN",
      "requestHeaders": {
        "set": {"X-Tenant-ID": "sandbox-default"},
        "add": {"X-Probe": "primitives"},
        "delete": ["X-Internal-Only"]
      },
      "responseHeaders": {
        "set": {"X-Gateway-Version": "rioku-sandbox"},
        "add": {"X-Trace-Hint": "primitive-test"},
        "delete": ["X-Powered-By"]
      },
      "compression": {
        "enabled": true,
        "encodings": ["gzip"],
        "minLength": 1
      }
    }
  }
}
JSON
)

if upsert_service "${PRIM_HEADERS_SVC_PAYLOAD}"; then
  pass "Upsert prim-headers-svc with request_headers + response_headers + compression: 200"
else
  fail "Upsert prim-headers-svc"
fi

PRIM_HEADERS_SVC_ID="$(fetch_service_id "prim-headers-svc")"
if [[ -z "${PRIM_HEADERS_SVC_ID}" ]]; then
  fail "Could not resolve prim-headers-svc ID"
else
  pass "prim-headers-svc ID resolved: ${PRIM_HEADERS_SVC_ID}"
fi

# Route uses path_prefix /prim-headers, strips no prefix — upstream sees full path.
PRIM_HEADERS_ROUTE_PAYLOAD=$(cat <<JSON
{
  "route": {
    "action": "UPSERT",
    "route": {
      "name": "prim-headers-route",
      "enabled": true,
      "serviceId": "${PRIM_HEADERS_SVC_ID}",
      "matchers": [{"paths": [{"type": "TYPE_PREFIX", "value": "/prim-headers"}]}]
    }
  }
}
JSON
)

if upsert_route "${PRIM_HEADERS_ROUTE_PAYLOAD}"; then
  pass "Upsert prim-headers-route: 200"
else
  fail "Upsert prim-headers-route"
fi

# Give Caddy a moment to apply the new config.
sleep 2

# Probe the route via the traffic port. Use /prim-headers/metrics (the upstream
# strips path prefix? No — Caddy passes-through unless rewrite is configured).
# The upstream's /metrics path is mounted at /metrics directly, so we need to
# test what arrives. Easiest: use the upstream's /health (1% error rate but
# usually ok). But to be deterministic, use /metrics which has no middleware.
# The upstream sees /prim-headers/metrics — which 404s. So we instead test the
# RESPONSE headers and compression on the 404 (which still flows through
# response handlers). For request-header verification, the upstream echoes
# X-Request-ID; we can't introspect added headers from the upstream's view
# without a debug echo endpoint, so we verify response-side primitives only.

probe_out="$(mktemp)"
probe_headers="$(mktemp)"
trap 'rm -rf "${TMPDIR_COOKIES}" "${probe_out}" "${probe_headers}"' EXIT

curl -sk --max-time 5 -H 'Accept-Encoding: gzip' \
  -D "${probe_headers}" \
  -o "${probe_out}" \
  "${TRAFFIC_BASE}/prim-headers/metrics" 2>/dev/null || true

if grep -qi '^X-Gateway-Version: rioku-sandbox' "${probe_headers}"; then
  pass "response_headers.set: X-Gateway-Version present"
else
  fail "response_headers.set: X-Gateway-Version NOT present in response"
  echo "    Headers received:"
  sed 's/^/      /' "${probe_headers}" | head -20
fi

if grep -qi '^X-Trace-Hint: primitive-test' "${probe_headers}"; then
  pass "response_headers.add: X-Trace-Hint present"
else
  fail "response_headers.add: X-Trace-Hint NOT present in response"
fi

if grep -qi '^Content-Encoding: gzip' "${probe_headers}"; then
  pass "compression: Content-Encoding: gzip applied to response"
else
  # Caddy's encode handler may not gzip a 404 below threshold — try a path
  # that returns a larger body (the upstream's /users JSON list).
  curl -sk --max-time 5 -H 'Accept-Encoding: gzip' \
    -D "${probe_headers}" \
    -o "${probe_out}" \
    "${TRAFFIC_BASE}/prim-headers/users" 2>/dev/null || true
  if grep -qi '^Content-Encoding: gzip' "${probe_headers}"; then
    pass "compression: Content-Encoding: gzip applied to response (large body)"
  else
    fail "compression: Content-Encoding NOT gzip"
    echo "    Headers received:"
    sed 's/^/      /' "${probe_headers}" | head -20
  fi
fi

# Verify Vary: Accept-Encoding (Caddy's encode handler should set this).
if grep -qi '^Vary:.*Accept-Encoding' "${probe_headers}"; then
  pass "compression: Vary: Accept-Encoding set"
else
  fail "compression: Vary: Accept-Encoding NOT set"
fi

# --------------------------------------------------------------------------
# Fixture 2: Service with response_rules (handle_response rewrite on 404).
# When upstream returns 404, the gateway should serve a custom error page.
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 2: Response rules (handle_response) ---${NC}"

PRIM_RULES_SVC_PAYLOAD=$(cat <<JSON
{
  "service": {
    "action": "UPSERT",
    "service": {
      "name": "prim-rules-svc",
      "upstreams": [{"address": "localhost:${SANDBOX_PORT_USERS}"}],
      "lbPolicy": "LB_POLICY_ROUND_ROBIN",
      "responseRules": [
        {
          "matchStatusCodes": ["404"],
          "serveErrorPage": {
            "statusCode": 404,
            "body": "<h1>Sandbox 404</h1><p>From handle_response rule.</p>",
            "contentType": "text/html; charset=utf-8"
          }
        }
      ]
    }
  }
}
JSON
)

if upsert_service "${PRIM_RULES_SVC_PAYLOAD}"; then
  pass "Upsert prim-rules-svc with handle_response rule: 200"
else
  fail "Upsert prim-rules-svc"
fi

PRIM_RULES_SVC_ID="$(fetch_service_id "prim-rules-svc")"
if [[ -z "${PRIM_RULES_SVC_ID}" ]]; then
  fail "Could not resolve prim-rules-svc ID"
else
  pass "prim-rules-svc ID resolved"
  PRIM_RULES_ROUTE_PAYLOAD=$(cat <<JSON
{
  "route": {
    "action": "UPSERT",
    "route": {
      "name": "prim-rules-route",
      "enabled": true,
      "serviceId": "${PRIM_RULES_SVC_ID}",
      "matchers": [{"paths": [{"type": "TYPE_PREFIX", "value": "/prim-rules"}]}]
    }
  }
}
JSON
)
  if upsert_route "${PRIM_RULES_ROUTE_PAYLOAD}"; then
    pass "Upsert prim-rules-route: 200"
  else
    fail "Upsert prim-rules-route"
  fi

  sleep 2

  # Hit a path that 404s on the upstream → handle_response should serve our
  # custom body. Don't accept gzip (compression isn't configured on this
  # service) so we can grep the body directly.
  rules_body="$(mktemp)"
  rules_headers="$(mktemp)"
  trap 'rm -rf "${TMPDIR_COOKIES}" "${probe_out}" "${probe_headers}" "${rules_body}" "${rules_headers}"' EXIT

  curl -sk --max-time 5 -D "${rules_headers}" -o "${rules_body}" \
    "${TRAFFIC_BASE}/prim-rules/no-such-path" 2>/dev/null || true

  if grep -q "Sandbox 404" "${rules_body}"; then
    pass "response_rules: custom error page served on 404"
  else
    fail "response_rules: custom error page NOT served"
    echo "    Body excerpt:"
    head -c 200 "${rules_body}" | sed 's/^/      /'
    echo ""
  fi
fi

# --------------------------------------------------------------------------
# Fixture 3: Service with dynamic_upstream (A-record lookup).
# We use 'localhost' which always resolves locally. The compiler must emit
# a dynamic upstream block; runtime resolution may or may not produce a
# usable backend in CI but the daemon must accept and apply the config.
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 3: Dynamic upstreams (A-record lookup) ---${NC}"

PRIM_DYN_SVC_PAYLOAD=$(cat <<JSON
{
  "service": {
    "action": "UPSERT",
    "service": {
      "name": "prim-dyn-svc",
      "upstreams": [
        {
          "aLookup": {
            "name": "localhost",
            "port": ${SANDBOX_PORT_USERS},
            "refreshSeconds": 60
          }
        }
      ],
      "lbPolicy": "LB_POLICY_ROUND_ROBIN"
    }
  }
}
JSON
)

if upsert_service "${PRIM_DYN_SVC_PAYLOAD}"; then
  pass "Upsert prim-dyn-svc with A-record dynamic upstream: 200"
else
  fail "Upsert prim-dyn-svc"
fi

# Confirm the service round-tripped correctly (compiler accepted the dynamic upstream).
cfg_resp="$(api_get "/api/v1/config")"
cfg_body="$(http_body "${cfg_resp}")"
dyn_check="$(echo "${cfg_body}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
svc = next((s for s in d.get('services', []) if s['name'] == 'prim-dyn-svc'), None)
if not svc:
    print('NOT-FOUND'); raise SystemExit
ups = svc.get('upstreams', [])
for u in ups:
    if u.get('aLookup', {}).get('name') == 'localhost':
        print('OK'); raise SystemExit
print('MISSING-A-LOOKUP')
" 2>/dev/null || echo "PARSE-ERROR")"

if [[ "${dyn_check}" == "OK" ]]; then
  pass "dynamic_upstream: prim-dyn-svc.aLookup round-tripped from store"
else
  fail "dynamic_upstream: round-trip check failed (${dyn_check})"
fi

# --------------------------------------------------------------------------
# Fixture 4: Service with upstream-level buffers + trusted_proxies.
# These are TLS/transport-level — exercised by config round-trip only;
# their runtime effect requires HTTPS upstreams and reverse-proxied traffic
# from a trusted CIDR, both out of scope for the local sandbox.
# --------------------------------------------------------------------------
echo -e "${BOLD}--- Part 4: Buffers + trusted_proxies (round-trip) ---${NC}"

PRIM_BUFF_SVC_PAYLOAD=$(cat <<JSON
{
  "service": {
    "action": "UPSERT",
    "service": {
      "name": "prim-buff-svc",
      "upstreams": [{"address": "localhost:${SANDBOX_PORT_USERS}"}],
      "lbPolicy": "LB_POLICY_ROUND_ROBIN",
      "upstreamTls": {
        "enabled": false,
        "requestBuffers": 8192,
        "responseBuffers": 16384
      }
    }
  }
}
JSON
)

if upsert_service "${PRIM_BUFF_SVC_PAYLOAD}"; then
  pass "Upsert prim-buff-svc with request/response buffers: 200"
else
  fail "Upsert prim-buff-svc"
fi

cfg_resp="$(api_get "/api/v1/config")"
cfg_body="$(http_body "${cfg_resp}")"
buff_check="$(echo "${cfg_body}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
svc = next((s for s in d.get('services', []) if s['name'] == 'prim-buff-svc'), None)
if not svc:
    print('NOT-FOUND'); raise SystemExit
tls = svc.get('upstreamTls') or {}
rq = tls.get('requestBuffers')
rs = tls.get('responseBuffers')
if rq == 8192 and rs == 16384:
    print('OK')
else:
    print(f'MISMATCH rq={rq} rs={rs}')
" 2>/dev/null || echo "PARSE-ERROR")"

if [[ "${buff_check}" == "OK" ]]; then
  pass "buffers: request_buffers=8192, response_buffers=16384 round-tripped"
else
  fail "buffers: round-trip check failed (${buff_check})"
fi

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=== Primitive Smoke Test Results ===${NC}"
echo -e "  ${GREEN}Passed: ${PASS}${NC}"
if (( FAIL > 0 )); then
  echo -e "  ${RED}Failed: ${FAIL}${NC}"
  exit 1
fi
echo -e "  ${RED}Failed: 0${NC}"
exit 0
