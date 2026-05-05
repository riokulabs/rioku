#!/bin/bash
set -euo pipefail
NAME="${1:-baseline}"
SNAP_DIR="sandbox/.data/snapshots"

if [ ! -f "$SNAP_DIR/$NAME.tar.gz" ]; then
  echo "snapshot not found: $SNAP_DIR/$NAME.tar.gz" >&2
  exit 1
fi

make sandbox-stop >/dev/null

# Wipe .data except snapshots dir
find sandbox/.data -mindepth 1 -maxdepth 1 ! -name snapshots -exec rm -rf {} +

# Extract snapshot
tar -xzf "$SNAP_DIR/$NAME.tar.gz" -C sandbox/.data

make sandbox >/dev/null

echo "restored from: $SNAP_DIR/$NAME.tar.gz"
