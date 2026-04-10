# Web Admin DX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Modernize the web admin toolchain (Vite 8, TS 6, Oxc, happy-dom), fix build performance, improve sandbox DX, and add contract tests to prevent proto/frontend type drift.

**Architecture:** Upgrade npm dependencies in-place, fix tsconfig/vite/vitest configs, add hash-based web build caching to the Makefile, add a `sandbox-status` script, add deterministic internal gateway ports, and add Go integration tests that validate REST JSON field names match frontend TypeScript types.

**Tech Stack:** Vite 8.0.7 (Rolldown), TypeScript 6.0.2, @vitejs/plugin-react 6.0.1 (Oxc), Vitest 4.1.3, happy-dom 20.8.9, Go 1.24+, bash

**Spec:** `docs/superpowers/specs/2026-04-08-web-admin-dx-overhaul-design.md`

---

## File Map

### Modified Files

| File | Changes |
|------|---------|
| `packages/web/package.json` | Upgrade all major deps, swap jsdom for happy-dom |
| `packages/web/tsconfig.json` | Add incremental compilation |
| `packages/web/vite.config.ts` | Fix alias, update for Vite 8 |
| `packages/web/vitest.config.ts` | Switch to happy-dom, update for Vitest 4 |
| `packages/web/src/test/setup.ts` | Remove jsdom-specific mocks if happy-dom provides them |
| `Makefile` | Add web-build-if-changed, sandbox-status, fix build chain |
| `packages/daemon/internal/config/file.go` | Add InternalPort to ListenConfig |
| `packages/daemon/internal/gateway/gateway.go` | Accept port range, auto-increment on bind failure |
| `packages/daemon/internal/daemon/daemon.go` | Use configured internal port instead of `:0` |
| `sandbox/scripts/start.sh` | Add stale sandbox detection |

### New Files

| File | Purpose |
|------|---------|
| `sandbox/scripts/status.sh` | Sandbox status dashboard |
| `packages/daemon/internal/gateway/contract_test.go` | Proto-to-frontend JSON field contract tests |

---

### Task 1: Upgrade npm Dependencies

**Files:**
- Modify: `packages/web/package.json`

- [x] **Step 1: Remove old packages and install new versions**

```bash
cd packages/web && \
npm uninstall @vitejs/plugin-react jsdom @vitest/coverage-v8 && \
npm install --save-dev \
  vite@^8 \
  @vitejs/plugin-react@^6 \
  typescript@^6 \
  vitest@^4 \
  @vitest/coverage-v8@^4 \
  happy-dom@^20
```

- [x] **Step 2: Verify package.json looks correct**

Run: `cd packages/web && node -e "const p=require('./package.json'); console.log('vite:', p.devDependencies.vite); console.log('plugin-react:', p.devDependencies['@vitejs/plugin-react']); console.log('typescript:', p.devDependencies.typescript); console.log('vitest:', p.devDependencies.vitest); console.log('happy-dom:', p.devDependencies['happy-dom']); console.log('jsdom:', p.devDependencies.jsdom || 'REMOVED')"`

Expected:
```
vite: ^8
plugin-react: ^6
typescript: ^6
vitest: ^4
happy-dom: ^20
jsdom: REMOVED
```

- [x] **Step 3: Verify no peer dependency warnings**

Run: `cd packages/web && npm ls --depth=0 2>&1 | grep -i 'WARN\|ERR\|peer' || echo "No warnings"`

Expected: No peer dependency errors. Possible warnings from optional deps are fine.

- [x] **Step 4: Commit**

```bash
cd packages/web && git add package.json package-lock.json
git commit -m "chore: upgrade vite 8, typescript 6, vitest 4, swap jsdom for happy-dom"
```

---

### Task 2: Fix TypeScript Config

**Files:**
- Modify: `packages/web/tsconfig.json`

- [x] **Step 1: Add incremental compilation**

Replace the full `packages/web/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/.cache/tsbuildinfo",
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

- [x] **Step 2: Fix build script to use tsc --noEmit instead of tsc -b**

In `packages/web/package.json`, change the `build` script from:
```json
"build": "tsc -b && vite build"
```
to:
```json
"build": "tsc --noEmit && vite build"
```

- [x] **Step 3: Verify type checking works**

Run: `cd packages/web && npx tsc --noEmit`

Expected: No errors (clean exit).

- [x] **Step 4: Verify incremental cache is created**

Run: `cd packages/web && npx tsc --noEmit && ls -la node_modules/.cache/tsbuildinfo`

Expected: File exists (build info cache created on first run).

- [x] **Step 5: Time the second run to confirm incremental speedup**

Run: `cd packages/web && time npx tsc --noEmit`

Expected: Significantly faster than the first run (should be under 2 seconds).

- [x] **Step 6: Commit**

```bash
cd packages/web && git add tsconfig.json package.json
git commit -m "perf: enable TypeScript incremental compilation, fix build script"
```

---

### Task 3: Update Vite Config for v8

**Files:**
- Modify: `packages/web/vite.config.ts`

- [x] **Step 1: Update vite.config.ts**

Replace `packages/web/vite.config.ts` with:

```typescript
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [TanStackRouterVite(), tailwindcss(), react()],
  build: { outDir: 'build', emptyOutDir: true },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7778',
        changeOrigin: true,
      },
    },
  },
})
```

Changes from previous version:
- Added `import { resolve } from 'path'`
- Fixed alias from `'@': '/src'` to `'@': resolve(__dirname, 'src')`
- The `react()` plugin import path is the same, but v6 now uses Oxc internally (no Babel)

- [x] **Step 2: Verify the build works end-to-end**

Run: `cd packages/web && npm run build`

Expected: Vite 8 build succeeds. Output shows Rolldown-based bundling. Build artifacts in `packages/web/build/`.

- [x] **Step 3: Verify dev server starts**

Run: `cd packages/web && timeout 10 npx vite --host 2>&1 | head -20 || true`

Expected: Vite dev server starts on port 5173 without errors.

- [x] **Step 4: Commit**

```bash
cd packages/web && git add vite.config.ts
git commit -m "chore: update vite config for v8, fix resolve alias"
```

---

### Task 4: Update Vitest Config + Test Setup

**Files:**
- Modify: `packages/web/vitest.config.ts`
- Modify: `packages/web/src/test/setup.ts`

- [x] **Step 1: Update vitest.config.ts to use happy-dom**

Replace `packages/web/vitest.config.ts` with:

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      include: ['src/lib/**', 'src/hooks/**', 'src/components/rioku/**', 'src/components/plugin/**', 'src/components/layout/**'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/components/ui/**',
        'src/routes/**',
        'src/routeTree.gen.ts',
        'src/main.tsx',
        'src/exports/**',
      ],
    },
    css: false,
  },
})
```

Changes: `environment: 'jsdom'` → `environment: 'happy-dom'`

- [x] **Step 2: Simplify test setup — remove jsdom-specific mocks**

Replace `packages/web/src/test/setup.ts` with:

```typescript
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Auto-cleanup after each test
afterEach(() => {
  cleanup()
})
```

happy-dom provides `matchMedia`, `ResizeObserver`, `IntersectionObserver`, and `navigator.clipboard` natively, so the manual mocks are no longer needed.

- [x] **Step 3: Run the full test suite**

Run: `cd packages/web && npx vitest run`

Expected: All tests pass. If any tests fail due to happy-dom behavioral differences, fix them in the next step.

- [x] **Step 4: Fix any test failures from the happy-dom switch**

If tests fail, the most common causes are:
- `window.matchMedia` returns slightly different mock shape → update test assertions
- `navigator.clipboard` API differences → add targeted mock only for clipboard tests

Read each failure, fix the specific test. Do not re-add blanket jsdom mocks.

- [x] **Step 5: Commit**

```bash
cd packages/web && git add vitest.config.ts src/test/setup.ts
git commit -m "perf: switch vitest to happy-dom, remove jsdom polyfill mocks"
```

---

### Task 5: Makefile — Smart Web Build Caching

**Files:**
- Modify: `Makefile`

- [x] **Step 1: Add web-build-if-changed target**

Add this target to the Makefile, after the existing `web-build` target (after line 278):

```makefile
## web-build-if-changed: Build web SPA only if source files changed (hash-based)
WEB_SRC_FILES = $(shell find packages/web/src -type f 2>/dev/null) packages/web/vite.config.ts packages/web/tsconfig.json packages/web/package.json
WEB_HASH_FILE = packages/web/build/.build-hash

web-build-if-changed:
	@CURRENT_HASH=$$(find packages/web/src -type f -exec sha256sum {} + 2>/dev/null | sort | sha256sum | cut -d' ' -f1); \
	for f in packages/web/vite.config.ts packages/web/tsconfig.json packages/web/package.json; do \
		CURRENT_HASH="$${CURRENT_HASH}$$(sha256sum "$$f" 2>/dev/null | cut -d' ' -f1)"; \
	done; \
	CURRENT_HASH=$$(echo "$${CURRENT_HASH}" | sha256sum | cut -d' ' -f1); \
	if [ -f "$(WEB_HASH_FILE)" ] && [ "$$(cat $(WEB_HASH_FILE))" = "$${CURRENT_HASH}" ]; then \
		echo "[OK]    web SPA unchanged — skipping rebuild"; \
	else \
		echo "==> Web SPA changed — rebuilding..."; \
		cd packages/web && npm run build; \
		echo "$${CURRENT_HASH}" > "../$(WEB_HASH_FILE)"; \
	fi
```

- [x] **Step 2: Update web-embed to use web-build-if-changed**

Change line 144 from:
```makefile
web-embed: web-build
```
to:
```makefile
web-embed: web-build-if-changed
```

- [x] **Step 3: Update .PHONY line to include new target**

Add `web-build-if-changed` to the `.PHONY` list on line 1.

- [x] **Step 4: Test the caching — first build should run, second should skip**

Run:
```bash
rm -f packages/web/build/.build-hash
make web-build-if-changed
```
Expected: "Web SPA changed — rebuilding..." then full build runs.

Run again:
```bash
make web-build-if-changed
```
Expected: "[OK]    web SPA unchanged — skipping rebuild"

- [x] **Step 5: Commit**

```bash
git add Makefile
git commit -m "perf: add hash-based web build caching to skip unnecessary rebuilds"
```

---

### Task 6: Sandbox Status Script

**Files:**
- Create: `sandbox/scripts/status.sh`
- Modify: `Makefile`

- [x] **Step 1: Create the status script**

Create `sandbox/scripts/status.sh`:

```bash
#!/usr/bin/env bash
# sandbox/scripts/status.sh — Show the status of all sandbox components.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DATA_DIR="${REPO_ROOT}/sandbox/.data"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
check_screen() {
  local session="$1"
  if command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -q "${session}"; then
    echo -e "${GREEN}running${NC}"
  else
    echo -e "${RED}stopped${NC}"
  fi
}

check_port() {
  local port="$1"
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    echo -e "${GREEN}listening${NC}"
  else
    echo -e "${RED}closed${NC}"
  fi
}

check_health() {
  local url="$1"
  local resp
  resp=$(curl -sf --max-time 2 "${url}" 2>/dev/null) && echo -e "${GREEN}healthy${NC}" || echo -e "${RED}unreachable${NC}"
}

# --------------------------------------------------------------------------
# Status table
# --------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=== Rioku Sandbox Status ===${NC}"
echo ""

printf "  ${CYAN}%-20s %-12s %-12s %-15s${NC}\n" "Component" "Screen" "Port" "Health"
echo "  ────────────────────────────────────────────────────────────"
printf "  %-20s %-12b %-12b %-15b\n" "daemon (REST)"    "$(check_screen rioku-daemon)"  "$(check_port 7778)" "$(check_health http://localhost:7778/api/v1/health)"
printf "  %-20s %-12b %-12b %-15b\n" "daemon (gRPC)"    ""                               "$(check_port 7777)" ""
printf "  %-20s %-12b %-12b %-15b\n" "traffic (Caddy)"  ""                               "$(check_port 8443)" ""
printf "  %-20s %-12b %-12b %-15b\n" "users"            "$(check_screen rioku-users)"    "$(check_port 9001)" "$(check_health http://localhost:9001/health)"
printf "  %-20s %-12b %-12b %-15b\n" "products"         "$(check_screen rioku-products)" "$(check_port 9002)" "$(check_health http://localhost:9002/health)"
printf "  %-20s %-12b %-12b %-15b\n" "webhooks"         "$(check_screen rioku-webhooks)" "$(check_port 9003)" "$(check_health http://localhost:9003/health)"
printf "  %-20s %-12b %-12b %-15b\n" "auth"             "$(check_screen rioku-auth)"     "$(check_port 9004)" "$(check_health http://localhost:9004/health)"
printf "  %-20s %-12b %-12b %-15b\n" "media"            "$(check_screen rioku-media)"    "$(check_port 9005)" "$(check_health http://localhost:9005/health)"

echo ""

# --------------------------------------------------------------------------
# Daemon log tail (if unhealthy)
# --------------------------------------------------------------------------
if ! curl -sf --max-time 2 http://localhost:7778/api/v1/health >/dev/null 2>&1; then
  if [[ -f "${DATA_DIR}/daemon.log" ]]; then
    echo -e "${YELLOW}Daemon is not healthy. Last 10 log lines:${NC}"
    echo ""
    tail -10 "${DATA_DIR}/daemon.log" | sed 's/^/    /'
    echo ""
  fi
fi
```

- [x] **Step 2: Make it executable**

Run: `chmod +x sandbox/scripts/status.sh`

- [x] **Step 3: Add Makefile target**

Add after the `sandbox-test-smoke` target (after line 89):

```makefile
## sandbox-status: Show status of all sandbox components
sandbox-status:
	@bash sandbox/scripts/status.sh
```

Add `sandbox-status` to the `.PHONY` list on line 1.

- [x] **Step 4: Test it**

Run: `make sandbox-status`

Expected: Table showing running/stopped status for each component with port and health info.

- [x] **Step 5: Commit**

```bash
git add sandbox/scripts/status.sh Makefile
git commit -m "feat: add make sandbox-status for sandbox introspection"
```

---

### Task 7: Deterministic Internal Gateway Port

**Files:**
- Modify: `packages/daemon/internal/config/file.go`
- Modify: `packages/daemon/internal/gateway/gateway.go`
- Modify: `packages/daemon/internal/daemon/daemon.go`

- [x] **Step 1: Add InternalPort to ListenConfig**

In `packages/daemon/internal/config/file.go`, change `ListenConfig` from:

```go
type ListenConfig struct {
	GRPC        string `yaml:"grpc"`
	REST        string `yaml:"rest"`
	AdminDomain string `yaml:"admin_domain"`
}
```

to:

```go
type ListenConfig struct {
	GRPC         string `yaml:"grpc"`
	REST         string `yaml:"rest"`
	AdminDomain  string `yaml:"admin_domain"`
	InternalPort int    `yaml:"internal_port"`
}
```

- [x] **Step 2: Set default internal port**

In the `Default()` function in `packages/daemon/internal/config/file.go`, change the `Listen` block from:

```go
Listen: ListenConfig{
	GRPC: ":7777",
	REST: ":7778",
},
```

to:

```go
Listen: ListenConfig{
	GRPC:         ":7777",
	REST:         ":7778",
	InternalPort: 7780,
},
```

- [x] **Step 3: Update daemon.go to use deterministic port with auto-increment**

In `packages/daemon/internal/daemon/daemon.go`, change line 138 from:

```go
gw, err := gateway.NewGateway("127.0.0.1:0", d.grpc.ConfigService(), d.grpc.HealthService(), d.auth, d.sessions, d.engine, d.store, d.cfg, spaFS)
```

to:

```go
basePort := d.cfg.Listen.InternalPort
if basePort == 0 {
	basePort = 7780
}
var gw *gateway.Gateway
for attempt := 0; attempt < 10; attempt++ {
	addr := fmt.Sprintf("127.0.0.1:%d", basePort+attempt)
	gw, err = gateway.NewGateway(addr, d.grpc.ConfigService(), d.grpc.HealthService(), d.auth, d.sessions, d.engine, d.store, d.cfg, spaFS)
	if err == nil {
		break
	}
	if attempt == 9 {
		log.Printf("rest: failed to bind internal gateway on ports %d-%d: %v", basePort, basePort+9, err)
	}
}
```

Also add `"fmt"` to the imports if not already present. The gateway's `NewGateway` already returns an error when `net.Listen` fails, so the retry loop catches bind failures and tries the next port.

- [x] **Step 5: Verify it compiles**

Run: `cd packages/daemon && go build ./...`

Expected: Clean compilation.

- [x] **Step 6: Commit**

```bash
git add packages/daemon/internal/config/file.go packages/daemon/internal/gateway/gateway.go packages/daemon/internal/daemon/daemon.go
git commit -m "feat: deterministic internal gateway port (default 7780)"
```

---

### Task 8: Stale Sandbox Detection

**Files:**
- Modify: `sandbox/scripts/start.sh`
- Modify: `Makefile` (sandbox-restart-daemon target)

- [x] **Step 1: Add stale detection to start.sh**

In `sandbox/scripts/start.sh`, add this block after the `cleanup_on_error` trap (after line 71), before the helpers section:

```bash
# --------------------------------------------------------------------------
# Pre-flight: check for existing sandbox
# --------------------------------------------------------------------------
RUNNING_SESSIONS=()
if command -v screen >/dev/null 2>&1; then
  for session in rioku-daemon rioku-users rioku-products rioku-webhooks rioku-auth rioku-media; do
    if screen -ls 2>/dev/null | grep -q "${session}"; then
      RUNNING_SESSIONS+=("${session}")
    fi
  done
fi

if (( ${#RUNNING_SESSIONS[@]} > 0 )); then
  # Check if processes are actually alive behind the screen sessions.
  any_alive=false
  for session in "${RUNNING_SESSIONS[@]}"; do
    pid=$(screen -ls 2>/dev/null | grep "${session}" | awk '{print $1}' | cut -d. -f1)
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      any_alive=true
      break
    fi
  done

  if [[ "${any_alive}" == "true" ]]; then
    echo -e "${RED}[ERROR]${NC} Sandbox is already running."
    echo -e "         Running sessions: ${RUNNING_SESSIONS[*]}"
    echo -e "         Run ${BOLD}make sandbox-stop${NC} first, or ${BOLD}make sandbox-reset${NC} to wipe and restart."
    exit 1
  else
    warn "Found stale screen sessions: ${RUNNING_SESSIONS[*]}"
    info "Cleaning up stale sessions..."
    for session in "${RUNNING_SESSIONS[@]}"; do
      screen -S "${session}" -X quit 2>/dev/null || true
    done
    success "Stale sessions cleaned up"
  fi
fi
```

- [x] **Step 2: Add Caddy cleanup to sandbox-restart-daemon**

In the `Makefile`, in the `sandbox-restart-daemon` target, add Caddy cleanup before restarting the daemon. Change the restart block (lines 38-48) from:

```makefile
	@if command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -q "rioku-daemon"; then \
	  screen -S rioku-daemon -X quit 2>/dev/null || true; \
	  sleep 1; \
```

to:

```makefile
	@if command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -q "rioku-daemon"; then \
	  screen -S rioku-daemon -X quit 2>/dev/null || true; \
	  sleep 1; \
	  STALE_CADDY=$$(pgrep -f "caddy run" 2>/dev/null || true); \
	  if [ -n "$${STALE_CADDY}" ]; then \
	    echo "  killing stale Caddy process(es): $${STALE_CADDY}"; \
	    kill $${STALE_CADDY} 2>/dev/null || true; \
	    sleep 1; \
	  fi; \
```

Apply the same change to the `sandbox-restart-daemon-fast` target (lines 62-72).

- [x] **Step 3: Test stale detection**

Start the sandbox:
```bash
make sandbox
```

Try starting again:
```bash
make sandbox
```

Expected: Error message "Sandbox is already running. Run `make sandbox-stop` first..."

- [x] **Step 4: Test stale cleanup**

Start the sandbox, then kill screen sessions manually (simulating a crash):
```bash
make sandbox
# Kill the daemon process behind the screen but leave the screen session
screen -S rioku-daemon -X stuff $'\003'
sleep 2
make sandbox
```

Expected: "Found stale screen sessions... Cleaning up... " then sandbox starts normally.

- [x] **Step 5: Commit**

```bash
git add sandbox/scripts/start.sh Makefile
git commit -m "fix: detect stale sandbox, kill orphaned Caddy on restart"
```

---

### Task 9: Proto-to-Frontend Contract Tests

**Files:**
- Create: `packages/daemon/internal/gateway/contract_test.go`

- [x] **Step 1: Create the contract test file**

Create `packages/daemon/internal/gateway/contract_test.go`:

```go
package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// contractEndpoint defines the expected JSON field names for a REST endpoint.
// These MUST match the TypeScript interfaces in packages/web/src/lib/api.ts.
// If you change a proto field name, update both this test AND the TypeScript type.
type contractEndpoint struct {
	method string
	path   string
	fields []string // top-level JSON field names expected in the response
	isArray bool    // true if response is a JSON array (check fields on first element)
}

// expectedContracts defines the REST API contract between backend and frontend.
// Field names come from protojson (camelCase) output.
var expectedContracts = []contractEndpoint{
	{
		method: "GET",
		path:   "/api/v1/health",
		fields: []string{"overall", "store", "caddy", "version", "uptime"},
	},
	{
		method: "GET",
		path:   "/api/v1/config",
		fields: []string{"version", "routes", "services", "policies"},
	},
	{
		method: "GET",
		path:   "/api/v1/audit",
		fields: []string{"id", "actor", "entityType", "entityId", "operation", "diff", "configVersion", "occurredAt"},
		isArray: true,
	},
	{
		method: "GET",
		path:   "/api/v1/auth/me",
		fields: []string{"user", "session"},
	},
}

func TestRESTContractFields(t *testing.T) {
	ctx := context.Background()

	// Set up SQLite store.
	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "contract.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	// Create a test user.
	password := "TestPassword123!"
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.CreateUser(ctx, &store.User{
		Username:          "contract-test",
		PasswordHash:      hash,
		Status:            "active",
		PasswordChangedAt: time.Now().UTC(),
	})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// Insert an audit entry so /audit returns data.
	tx2, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx2.AppendAuditEntry(ctx, "contract-test", "config", "test-id", "create", "{}", 1); err != nil {
		tx2.Rollback()
		t.Fatal(err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatal(err)
	}

	// Set up auth + session manager.
	signingKey := []byte("test-signing-key-32-bytes-long!!")
	a := auth.NewAuth(signingKey, drv)
	sm := auth.NewSessionManager(drv, true)
	cfg := config.Default()

	encKey, err := auth.DeriveEncryptionKey(signingKey, totpEncryptionSalt)
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	// Build the full handler chain.
	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterAuditRoutes(mux, drv)
	RegisterKeyRoutes(mux, a, drv)
	RegisterHealthRoutes(mux, drv, cfg)
	RegisterStubRoutes(mux, cfg)

	var handler http.Handler = mux
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	// Login to get a session.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	loginBody := `{"username":"contract-test","password":"` + password + `"}`
	loginResp, err := client.Post(server.URL+"/api/v1/auth/login", "application/json", strings.NewReader(loginBody))
	if err != nil {
		t.Fatal(err)
	}
	loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login failed: status %d", loginResp.StatusCode)
	}

	// Test each endpoint's contract.
	for _, ep := range expectedContracts {
		t.Run(ep.method+"_"+ep.path, func(t *testing.T) {
			req, err := http.NewRequest(ep.method, server.URL+ep.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			resp, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				t.Fatalf("expected 200, got %d", resp.StatusCode)
			}

			var responseFields map[string]any
			if ep.isArray {
				var arr []map[string]any
				if err := json.NewDecoder(resp.Body).Decode(&arr); err != nil {
					t.Fatalf("decode array response: %v", err)
				}
				if len(arr) == 0 {
					t.Fatal("expected non-empty array to validate field names")
				}
				responseFields = arr[0]
			} else {
				if err := json.NewDecoder(resp.Body).Decode(&responseFields); err != nil {
					t.Fatalf("decode response: %v", err)
				}
			}

			for _, field := range ep.fields {
				if _, ok := responseFields[field]; !ok {
					keys := make([]string, 0, len(responseFields))
					for k := range responseFields {
						keys = append(keys, k)
					}
					t.Errorf("missing field %q in %s %s response (got fields: %v)", field, ep.method, ep.path, keys)
				}
			}
		})
	}
}
```

- [x] **Step 2: Check if RegisterHealthRoutes exists, if not check the correct registration function name**

Run: `cd packages/daemon && grep -rn 'func Register.*Routes' internal/gateway/*.go | grep -v test`

If `RegisterHealthRoutes` doesn't exist, check what the health endpoint registration function is called and update the test accordingly. The health endpoint may be registered via grpc-gateway or as a stub — adjust the `RegisterStubRoutes` or handler setup as needed.

- [x] **Step 3: Run the contract test**

Run: `cd packages/daemon && go test -race -run TestRESTContractFields ./internal/gateway/ -v -timeout 60s`

Expected: All subtests pass. Each endpoint returns the expected field names.

- [x] **Step 4: Verify it catches a field name mismatch**

Temporarily change one expected field in the test (e.g., change `"occurredAt"` to `"timestamp"`) and run:

```bash
cd packages/daemon && go test -race -run TestRESTContractFields ./internal/gateway/ -v -timeout 60s
```

Expected: Test FAILS with `missing field "timestamp"` — proving the contract test catches the exact bug class we hit today.

Revert the temporary change.

- [x] **Step 5: Commit**

```bash
git add packages/daemon/internal/gateway/contract_test.go
git commit -m "test: add proto-to-frontend REST contract tests"
```

---

### Task 10: Final Validation

**Files:** None (validation only)

- [x] **Step 1: Full Go test suite**

Run: `cd packages/daemon && go test -race ./... -timeout 300s`

Expected: All tests pass including new contract tests.

- [x] **Step 2: Full web test suite**

Run: `cd packages/web && npx vitest run`

Expected: All tests pass with happy-dom.

- [x] **Step 3: Full web build**

Run: `cd packages/web && npm run build`

Expected: Build succeeds. Note the build time — should be significantly faster than before.

- [x] **Step 4: Smart rebuild test**

Run: `make build-daemon`

Expected: First run builds everything. Second `make build-daemon` says "[OK] web SPA unchanged — skipping rebuild" and only runs Go build.

- [x] **Step 5: Sandbox restart with new port**

If sandbox is running:
```bash
make sandbox-restart-daemon
make sandbox-status
```

Expected: Daemon restarts, status shows all components healthy, no 502 errors. Daemon log should show `rest: internal gateway bound to 127.0.0.1:7780` (deterministic port).

- [x] **Step 6: Commit any remaining fixes**

If any adjustments were needed during validation, commit them:

```bash
git add -A
git commit -m "fix: address issues found during DX overhaul validation"
```
