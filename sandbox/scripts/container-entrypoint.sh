#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${RIOKU_DATA_DIR:-/data}"
CONFIG_FILE="${DATA_DIR}/rioku.yaml"

# First run: initialize config store, root user, and bootstrap token.
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[container] Initializing Rioku..."
  rioku init \
    --config-file "$CONFIG_FILE" \
    --data-dir "$DATA_DIR" \
    --store sqlite \
    --non-interactive \
    --no-force-password-change \
    --root-password "${SANDBOX_ROOT_PASSWORD:-SandboxRoot1234!}"

  echo "${SANDBOX_ROOT_PASSWORD:-SandboxRoot1234!}" > "${DATA_DIR}/root-password"
fi

# Start the daemon.
exec rioku start --config-file "$CONFIG_FILE"
