#!/bin/bash
# Capture sandbox state to a tarball for test-isolation snapshot/restore.
set -euo pipefail
NAME="${1:-baseline}"
SNAP_DIR="sandbox/.data/snapshots"
mkdir -p "$SNAP_DIR"

# Stop daemon to ensure SQLite is consistent
make sandbox-stop >/dev/null

# Tarball includes: SQLite DB file + .data tree minus snapshot dir itself
tar --exclude='snapshots' -czf "$SNAP_DIR/$NAME.tar.gz" -C sandbox/.data .

# Restart daemon
make sandbox >/dev/null

echo "snapshot saved: $SNAP_DIR/$NAME.tar.gz"
