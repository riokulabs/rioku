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

# --------------------------------------------------------------------------
# Load environment config
# --------------------------------------------------------------------------
ENV_FILE="${SANDBOX_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi
: "${SANDBOX_PORT_REST:=7778}"
: "${SANDBOX_PORT_USERS:=9001}"
: "${SANDBOX_PORT_PRODUCTS:=9002}"
: "${SANDBOX_PORT_WEBHOOKS:=9003}"
: "${SANDBOX_PORT_AUTH:=9004}"
: "${SANDBOX_PORT_MEDIA:=9005}"

# --------------------------------------------------------------------------
# Derived paths and addresses
# --------------------------------------------------------------------------
DATA_DIR="${SANDBOX_DIR}/.data"
SEED_DIR="${SANDBOX_DIR}/seed"
REST_BASE="${1:-http://localhost:${SANDBOX_PORT_REST}}"

# --------------------------------------------------------------------------
# Dependency checks
# --------------------------------------------------------------------------
for cmd in curl; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo -e "${RED}[FAIL]${NC}  Required tool '${cmd}' not found. Install it and try again."
    exit 1
  fi
done

DAEMON_BIN="${REPO_ROOT}/bin/rioku"
if [[ ! -x "${DAEMON_BIN}" ]]; then
    echo -e "${RED}[FAIL]${NC}  rioku binary not found at ${DAEMON_BIN}"
    echo "        Build it first: make build (from repo root)"
    exit 1
fi

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

if [[ ! -d "${SEED_DIR}" ]]; then
    echo -e "${RED}[FAIL]${NC}  Seed directory not found: ${SEED_DIR}"
    exit 1
fi

# --------------------------------------------------------------------------
# Apply seed config via rioku seed --dir
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==> Seeding configuration${NC}"
info "Seeding from ${SEED_DIR}/ ..."

if ! "${DAEMON_BIN}" seed \
    --dir "${SEED_DIR}" \
    --target "${REST_BASE}" \
    --password "${ROOT_PASSWORD}"; then
    warn "Seed encountered errors — daemon API may not be fully implemented yet"
    warn "Run 'make sandbox-seed' manually once the daemon is healthy"
else
    success "Config seed complete"
fi

echo ""
echo -e "${BOLD}Config seeding complete.${NC}"
echo ""

# --------------------------------------------------------------------------
# Cross-tenant seed
# --------------------------------------------------------------------------
# The default seed flow only populates `default`. Tests target /t/acme/*
# and /t/beta/* too, so we replicate a minimum set of resources into the
# non-default tenants via REST POST. Soft-failure: warnings only.
if [[ -x "${SCRIPT_DIR}/seed-cross-tenant.sh" ]]; then
    if ! "${SCRIPT_DIR}/seed-cross-tenant.sh" "${REST_BASE}"; then
        warn "Cross-tenant seed failed — non-fatal; e2e tests targeting acme/beta may fail"
    fi
fi
