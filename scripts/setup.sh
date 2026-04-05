#!/usr/bin/env bash
# Rioku development environment setup.
# Checks for required tools and installs what's missing via mise.
# Supports macOS and Linux.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[MISS]${NC} $1"; }

ERRORS=0

echo ""
echo "Rioku Development Environment Setup"
echo "===================================="
echo ""

# Detect OS
OS=$(uname -s)
case "$OS" in
  Linux*)  OS_NAME="linux" ;;
  Darwin*) OS_NAME="macos" ;;
  *)       echo "Unsupported OS: $OS"; exit 1 ;;
esac
info "OS: $OS_NAME ($(uname -m))"

# Check for mise
if command -v mise &>/dev/null; then
  info "mise $(mise --version | head -1)"
else
  warn "mise not installed — installing..."
  curl https://mise.run | sh
  export PATH="$HOME/.local/bin:$PATH"
  if command -v mise &>/dev/null; then
    info "mise installed"
  else
    fail "mise installation failed. See https://mise.jdx.dev/getting-started.html"
    ERRORS=$((ERRORS + 1))
  fi
fi

# Activate mise and install tools
if command -v mise &>/dev/null; then
  echo ""
  echo "Installing tools via mise..."
  mise trust --all 2>/dev/null || true
  mise install
  eval "$(mise activate bash)"
  echo ""
fi

# Verify required tools
echo "Checking required tools..."
echo ""

check_tool() {
  local name=$1
  local cmd=$2
  local version_flag=${3:---version}

  if command -v "$cmd" &>/dev/null; then
    local ver
    ver=$($cmd $version_flag 2>&1 | head -1)
    info "$name: $ver"
  else
    fail "$name not found"
    ERRORS=$((ERRORS + 1))
  fi
}

check_tool "Go"             go        version
check_tool "Node.js"        node      --version
check_tool "npm"            npm       --version
check_tool "buf"            buf       --version
check_tool "golangci-lint"  golangci-lint --version
check_tool "cspell"         cspell    --version
check_tool "git-cliff"      git-cliff --version
check_tool "git"            git       --version

# Check optional tools
echo ""
echo "Checking optional tools..."
echo ""

if command -v xcaddy &>/dev/null; then
  info "xcaddy: $(xcaddy version 2>&1 | head -1)"
else
  warn "xcaddy not installed (needed for traffic plugin builds)"
  echo "       Install: go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest"
fi

# Install git hooks
echo ""
echo "Setting up git hooks..."
git config core.hooksPath .githooks
info "Git hooks installed (.githooks/)"

# Install Go module dependencies
echo ""
echo "Downloading Go dependencies..."
(cd packages/daemon && go mod download) && info "daemon dependencies downloaded"
(cd packages/build-service && go mod download) && info "build-service dependencies downloaded"

# Summary
echo ""
echo "===================================="
if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}Setup incomplete: $ERRORS tool(s) missing.${NC}"
  echo "Install missing tools and re-run this script."
  exit 1
else
  echo -e "${GREEN}Development environment ready.${NC}"
  echo ""
  echo "Quick start:"
  echo "  make build          # Build daemon binary"
  echo "  make test-race      # Run tests"
  echo "  make proto          # Generate proto code"
  echo "  make lint           # Run linters"
fi
