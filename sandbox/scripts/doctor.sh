#!/bin/bash
# Health-probe every sandbox container + service against shifted ports.
set -uo pipefail

# Load .env so SANDBOX_PORT_* vars are present
if [ -f sandbox/.env ]; then set -a; . sandbox/.env; set +a; fi

REST_PORT="${SANDBOX_PORT_REST:-7778}"
TRAFFIC_PORT="${SANDBOX_PORT_TRAFFIC:-8443}"
MAILPIT_UI="${SANDBOX_PORT_MAILPIT_UI:-18025}"
MAILPIT_SMTP="${SANDBOX_PORT_MAILPIT_SMTP:-11025}"
PROM_PORT="${SANDBOX_PORT_PROMETHEUS:-19090}"
GRAFANA_PORT="${SANDBOX_PORT_GRAFANA:-13000}"
OTEL_GRPC="${SANDBOX_PORT_OTEL_GRPC:-14317}"
TEMPO_PORT="${SANDBOX_PORT_TEMPO:-13200}"
PEBBLE_ACME="${SANDBOX_PORT_PEBBLE_ACME:-14000}"

fail=0

check_http() {
  local label="$1" url="$2"
  if curl -sfo /dev/null --max-time 3 "$url"; then
    echo "  ✓ $label ($url)"
  else
    echo "  ✗ $label unreachable ($url)"
    fail=1
  fi
}

check_tcp() {
  local label="$1" host="$2" port="$3"
  if timeout 3 bash -c "</dev/tcp/$host/$port" 2>/dev/null; then
    echo "  ✓ $label ($host:$port)"
  else
    echo "  ✗ $label unreachable ($host:$port)"
    fail=1
  fi
}

echo "== Sandbox doctor =="
check_http "daemon REST"     "http://localhost:$REST_PORT/healthz"
check_http "Caddy traffic"   "https://localhost:$TRAFFIC_PORT/" || true
check_http "Mailpit UI"      "http://localhost:$MAILPIT_UI/api/v1/info"
check_tcp  "Mailpit SMTP"    localhost "$MAILPIT_SMTP"
check_http "Prometheus"      "http://localhost:$PROM_PORT/-/healthy"
check_http "Grafana"         "http://localhost:$GRAFANA_PORT/api/health"
check_tcp  "OTel gRPC"       localhost "$OTEL_GRPC"
check_http "Tempo"           "http://localhost:$TEMPO_PORT/ready"
check_tcp  "Pebble ACME"     localhost "$PEBBLE_ACME"

if [ $fail -eq 0 ]; then
  echo "== All green =="
  exit 0
else
  echo "== Doctor found failures =="
  exit 1
fi
