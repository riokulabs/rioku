.PHONY: all build build-daemon build-daemon-fast build-daemon-lean build-service proto proto-lint test test-race test-security test-raft-cluster test-coverage coverage-baseline lint lint-commit lint-spell clean web web-build web-build-if-changed web-embed web-dev test-web test-web-coverage ui-storybook test-ui hooks setup sandbox sandbox-stop sandbox-seed sandbox-reset sandbox-restart-daemon sandbox-restart-daemon-fast sandbox-restart-daemon-only sandbox-dev-web sandbox-test-auth sandbox-test-smoke sandbox-test-primitives sandbox-status sandbox-seed-users test-e2e test-e2e-full bench bench-compare bench-baseline sandbox-load sandbox-load-monitor sandbox-load-compare sandbox-container sandbox-container-stop sandbox-container-logs sandbox-container-clean docs-install docs-dev docs-build contrib-docs-install contrib-docs-dev contrib-docs-build help

# Variables
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS  = -X github.com/riokulabs/rioku/internal/version.Version=$(VERSION) \
           -X github.com/riokulabs/rioku/internal/version.Commit=$(COMMIT) \
           -X github.com/riokulabs/rioku/internal/version.Date=$(DATE)

BIN_DIR  = bin
GO       = go
PKG      = packages

# Use nvm's Node 22 for web targets (Vite 8 requires Node 20.19+ or 22.12+).
NVM_DIR  ?= $(HOME)/.nvm
NODE22   = $(NVM_DIR)/versions/node/$(shell ls $(NVM_DIR)/versions/node/ 2>/dev/null | grep '^v22' | tail -1)
WEB_PATH = $(if $(wildcard $(NODE22)/bin/node),PATH=$(NODE22)/bin:$(PATH),)

## sandbox: Start sandbox environment (daemon + apps built in parallel inside start.sh)
.PHONY: sandbox sandbox-stop sandbox-seed sandbox-logs sandbox-clean
sandbox:
	@bash sandbox/scripts/start.sh

## sandbox-stop: Stop sandbox environment
sandbox-stop:
	@bash sandbox/scripts/stop.sh

## sandbox-seed: Re-seed sandbox data from seed.yaml (requires running sandbox)
sandbox-seed:
	@if [ -f sandbox/.data/root-password ]; then \
	  bin/rioku seed \
	    --file sandbox/config/seed.yaml \
	    --target "http://localhost:$${SANDBOX_PORT_REST:-7778}" \
	    --password "$$(cat sandbox/.data/root-password)"; \
	else \
	  echo "[FAIL]  sandbox/.data/root-password not found"; \
	  echo "        Is the sandbox running? Start it with: make sandbox"; \
	  exit 1; \
	fi

## sandbox-reset: Stop sandbox, wipe all data, restart fresh
sandbox-reset: sandbox-stop
	@echo "==> Wiping sandbox data..."
	rm -rf sandbox/.data
	@echo "==> Starting fresh sandbox..."
	$(MAKE) sandbox

## sandbox-restart-daemon: Rebuild daemon + restart without touching upstream apps (~5s)
sandbox-restart-daemon: build-daemon
	@bash sandbox/scripts/restart-daemon.sh

## sandbox-restart-daemon-fast: Rebuild daemon (skip web) + restart (~3s)
sandbox-restart-daemon-fast: build-daemon-fast
	@bash sandbox/scripts/restart-daemon.sh

## sandbox-test-auth: Run auth smoke tests against running sandbox
sandbox-test-auth:
	@bash sandbox/scripts/test-auth.sh

## sandbox-test-smoke: Run full-stack smoke tests against running sandbox
sandbox-test-smoke:
	@bash sandbox/scripts/test-smoke.sh

## sandbox-test-primitives: Run Caddy primitive smoke tests (Sprint 1 surface) against running sandbox
sandbox-test-primitives:
	@bash sandbox/scripts/test-primitives.sh

## sandbox-logs: Stream all sandbox service logs (color-coded, Ctrl+C to stop)
sandbox-logs:
	@bash sandbox/scripts/logs.sh

## sandbox-logs-%: Stream logs for a specific service (e.g., make sandbox-logs-daemon)
sandbox-logs-%:
	@bash sandbox/scripts/logs.sh $*

## sandbox-status: Show status of all sandbox components
sandbox-status:
	@bash sandbox/scripts/status.sh

## sandbox-clean: Stop sandbox and wipe all data (logs, PIDs, config, database)
sandbox-clean: sandbox-stop
	rm -rf sandbox/.data

## sandbox-seed-users: Seed test users into a running sandbox (delegates to sandbox-seed)
sandbox-seed-users: sandbox-seed

## sandbox-dev-web: Start Vite dev server for live web admin editing (starts sandbox if not running)
sandbox-dev-web:
	@if ! curl -sf http://localhost:$${SANDBOX_PORT_REST:-7778}/api/v1/health >/dev/null 2>&1; then \
		$(MAKE) sandbox; \
	fi
	@echo ""
	@echo -e "  \033[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
	@echo -e "  \033[1;36m  Web Admin Dev Mode (HMR)\033[0m"
	@echo -e "  \033[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
	@echo -e "  Admin panel:  \033[1mhttp://localhost:5173\033[0m"
	@echo -e "  API backend:  http://localhost:$${SANDBOX_PORT_REST:-7778}"
	@echo -e "  Caddy proxy:  http://localhost:$${SANDBOX_PORT_TRAFFIC:-8443}"
	@echo ""
	@echo -e "  Edit packages/web/src/ → instant HMR refresh"
	@echo -e "  Backend changes → run 'make sandbox-restart-daemon-fast' in another terminal"
	@echo ""
	@cd packages/web && $(WEB_PATH) pnpm dev

## sandbox-restart-daemon-only: Rebuild + restart daemon only (for use alongside sandbox-dev-web)
sandbox-restart-daemon-only: build-daemon-fast
	@bash sandbox/scripts/restart-daemon.sh

## test-e2e: Run Playwright E2E tests (requires running sandbox)
test-e2e:
	cd $(PKG)/web && pnpm exec playwright test

## test-e2e-full: Start sandbox, run E2E tests, stop sandbox
test-e2e-full: build-daemon
	@echo "==> Starting sandbox for E2E tests..."
	@bash sandbox/scripts/start.sh &
	@echo "==> Waiting for sandbox health..."
	@for i in $$(seq 1 30); do \
	  if curl -sf --max-time 2 http://localhost:7778/api/v1/health >/dev/null 2>&1; then \
	    echo "[OK]    sandbox is healthy"; \
	    break; \
	  fi; \
	  if [ $$i -eq 30 ]; then \
	    echo "[FAIL]  sandbox did not become healthy in 30s"; \
	    bash sandbox/scripts/stop.sh 2>/dev/null; \
	    exit 1; \
	  fi; \
	  sleep 1; \
	done
	@echo "==> Running smoke tests..."
	@bash sandbox/scripts/test-smoke.sh
	@echo "==> Running Playwright E2E tests..."
	cd $(PKG)/web && pnpm exec playwright install --with-deps && npx playwright test
	@echo "==> Stopping sandbox..."
	@bash sandbox/scripts/stop.sh

## docs-install: Install user docs dependencies
docs-install:
	cd docs && $(WEB_PATH) npm install

## docs-dev: Run user docs dev server (localhost:3000)
docs-dev:
	cd docs && $(WEB_PATH) npm start

## docs-build: Build user docs for production
docs-build:
	cd docs && $(WEB_PATH) npm run build

## contrib-docs-install: Install contributor docs dependencies
contrib-docs-install:
	cd contrib-docs && $(WEB_PATH) npm install

## contrib-docs-dev: Run contributor docs dev server (localhost:3001)
contrib-docs-dev:
	cd contrib-docs && $(WEB_PATH) npm start

## contrib-docs-build: Build contributor docs for production
contrib-docs-build:
	cd contrib-docs && $(WEB_PATH) npm run build

## help: Show this help message
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //' | column -t -s ':'

## all: Build everything
all: proto build web-build

## build: Build daemon and CLI (same binary)
build: build-daemon

## build-daemon: Build the rioku daemon binary (embeds admin panel)
build-daemon: web-embed
	cd $(PKG)/daemon && $(GO) build -ldflags "$(LDFLAGS)" -o ../../$(BIN_DIR)/rioku ./cmd/rioku

## web-embed: Copy web build into daemon for go:embed
web-embed: web-build-if-changed
	@rm -rf $(PKG)/daemon/web/build
	@mkdir -p $(PKG)/daemon/web/build
	@cp -r $(PKG)/web/dist/. $(PKG)/daemon/web/build/

## build-daemon-fast: Build daemon binary without rebuilding web SPA (faster iteration)
## The go:embed directive requires packages/daemon/web/build/ to exist. If it
## doesn't (e.g. fresh clone / first CI run), fall back to a full build-daemon
## so web-embed runs. Otherwise reuse the existing embedded assets.
build-daemon-fast:
	@if [ ! -f $(PKG)/daemon/web/build/index.html ]; then \
		echo "==> No embedded web assets yet — running full build-daemon..."; \
		$(MAKE) build-daemon; \
	else \
		cd $(PKG)/daemon && $(GO) build -ldflags "$(LDFLAGS)" -o ../../$(BIN_DIR)/rioku ./cmd/rioku; \
	fi

## build-daemon-lean: Build daemon without admin panel (smaller binary for cluster members)
build-daemon-lean:
	cd $(PKG)/daemon && $(GO) build -tags noadmin -ldflags "$(LDFLAGS)" -o ../../$(BIN_DIR)/rioku ./cmd/rioku

## build-service: Build the build service binary
build-service:
	cd $(PKG)/build-service && $(GO) build -ldflags "$(LDFLAGS)" -o ../../$(BIN_DIR)/rioku-build-service ./cmd/rioku-build-service

## proto: Generate Go code from proto definitions
proto:
	cd $(PKG)/proto && buf generate

## proto-lint: Lint proto definitions
proto-lint:
	cd $(PKG)/proto && buf lint

## proto-breaking: Check for breaking proto changes
proto-breaking:
	cd $(PKG)/proto && buf breaking --against '.git#branch=main'

## openapi: Merge buf-generated swagger files with hand-written
##          fragments into a single canonical document at
##          packages/proto/gen/openapi/rioku/v1/api.full.json. Run
##          after `make proto` whenever the proto definitions OR the
##          hand-written fragments change.
openapi:
	cd $(PKG)/daemon && $(GO) run ./cmd/openapi-merge \
		-base ../../$(PKG)/proto/gen/openapi/rioku/v1/config.swagger.json \
		-extra-bases ../../$(PKG)/proto/gen/openapi/rioku/v1/ \
		-fragments ../../$(PKG)/proto/openapi-fragments/ \
		-out ../../$(PKG)/proto/gen/openapi/rioku/v1/api.full.json

## test: Run all tests
test:
	cd $(PKG)/daemon && $(GO) test ./...
	cd $(PKG)/build-service && $(GO) test ./...
	cd $(PKG)/web && pnpm test

## test-fast: Run tests with race detector, skip scale tests (for local iteration)
test-fast:
	cd $(PKG)/daemon && $(GO) test -race -short ./...
	cd $(PKG)/build-service && $(GO) test -race -short ./...

## test-race: Run all tests with race detector (CI — includes scale tests)
test-race:
	cd $(PKG)/daemon && $(GO) test -race ./...
	cd $(PKG)/build-service && $(GO) test -race ./...

## test-security: Run security test suite (injection, timing, fixation)
test-security:
	cd $(PKG)/daemon && $(GO) test -race -run 'TestTimingAttack|TestSessionFixation|TestCookieScope|TestSQLInjection|TestXSS|TestRequestSmuggling|TestPasswordPolicy' ./internal/gateway/ -v -timeout 120s

## test-raft-cluster: Run raft 3-node cluster tests
test-raft-cluster:
	cd $(PKG)/daemon && $(GO) test -race -run 'TestCluster' ./internal/store/raft/ -v -timeout 120s

## test-coverage: Run Go tests with coverage and check against baseline
test-coverage:
	cd $(PKG)/daemon && $(GO) test -race -coverprofile=coverage.out ./...
	@cd $(PKG)/daemon && COVERAGE=$$($(GO) tool cover -func=coverage.out | grep total | awk '{print $$3}' | tr -d '%') && \
		BASELINE=$$(cat bench/coverage-baseline.txt 2>/dev/null || echo "0") && \
		echo "Coverage: $${COVERAGE}% (baseline: $${BASELINE}%)" && \
		if [ "$$(echo "$${COVERAGE} < $${BASELINE} - 0.5" | bc)" = "1" ]; then \
			echo "ERROR: Coverage dropped below baseline"; exit 1; \
		fi

## coverage-baseline: Update coverage baseline from current results
coverage-baseline:
	cd $(PKG)/daemon && $(GO) test -race -coverprofile=coverage.out ./...
	@cd $(PKG)/daemon && $(GO) tool cover -func=coverage.out | grep total | awk '{print $$3}' | tr -d '%' > bench/coverage-baseline.txt
	@echo "Coverage baseline updated to $$(cat $(PKG)/daemon/bench/coverage-baseline.txt)%"

## test-integration: Run integration tests (requires databases)
test-integration:
	cd $(PKG)/daemon && $(GO) test -tags integration -race ./...

## bench: Run all Go benchmarks (output to packages/daemon/bench/results.txt)
bench:
	cd $(PKG)/daemon && $(GO) test -bench=. -benchmem -count=5 -run=^$$ ./... 2>&1 | tee bench/results.txt
	@echo "Results saved to packages/daemon/bench/results.txt"

## bench-baseline: Save current benchmark results as the new baseline
bench-baseline: bench
	cp $(PKG)/daemon/bench/results.txt $(PKG)/daemon/bench/baseline.txt
	@echo "Baseline updated: packages/daemon/bench/baseline.txt"

## bench-compare: Compare current benchmarks against baseline (requires benchstat)
bench-compare: bench
	@if ! command -v benchstat >/dev/null 2>&1; then \
		echo "Installing benchstat..."; \
		$(GO) install golang.org/x/perf/cmd/benchstat@latest; \
	fi
	benchstat $(PKG)/daemon/bench/baseline.txt $(PKG)/daemon/bench/results.txt

## sandbox-load: Run standard load profile (direct + proxied), requires running sandbox
sandbox-load:
	@echo "Building load tester..."
	cd sandbox/loadtest && GOWORK=off $(GO) build -o ../../$(BIN_DIR)/rioku-loadtest .
	@echo "Running standard load profile..."
	./$(BIN_DIR)/rioku-loadtest \
		--profile sandbox/loadtest/profiles/standard.json \
		--mode both \
		--output sandbox/loadtest/results.json
	@echo "Results: sandbox/loadtest/results.json"

## sandbox-load-monitor: Run soak load profile with resource monitoring
sandbox-load-monitor:
	@echo "Building load tester..."
	cd sandbox/loadtest && GOWORK=off $(GO) build -o ../../$(BIN_DIR)/rioku-loadtest .
	@echo "Running soak profile with monitoring..."
	./$(BIN_DIR)/rioku-loadtest \
		--profile sandbox/loadtest/profiles/soak.json \
		--mode proxied \
		--monitor \
		--pprof \
		--output sandbox/loadtest/soak-results.json
	@echo "Results: sandbox/loadtest/soak-results.json"
	@echo "Profiles: sandbox/loadtest/heap-*.prof, goroutine-*.prof"

## sandbox-load-compare: Compare load results against baseline
sandbox-load-compare: sandbox-load
	@if [ ! -f sandbox/loadtest/baseline.json ]; then \
		echo "No baseline found. Run: cp sandbox/loadtest/results.json sandbox/loadtest/baseline.json"; \
		exit 1; \
	fi
	@echo "==> Load test comparison (baseline vs current):"
	@echo "Baseline:"
	@cat sandbox/loadtest/baseline.json | python3 -m json.tool 2>/dev/null || cat sandbox/loadtest/baseline.json
	@echo ""
	@echo "Current:"
	@cat sandbox/loadtest/results.json | python3 -m json.tool 2>/dev/null || cat sandbox/loadtest/results.json

## lint: Run linters
lint:
	cd $(PKG)/daemon && golangci-lint run ./...
	cd $(PKG)/build-service && golangci-lint run ./...

## web: Install web dependencies
web:
	cd $(PKG)/web && $(WEB_PATH) pnpm install

## web-build: Build the admin panel SPA
web-build:
	cd $(PKG)/web && $(WEB_PATH) pnpm build

## web-build-if-changed: Build web SPA only if source files changed (hash-based)
WEB_HASH_FILE = packages/web/.build-hash

web-build-if-changed:
	@CURRENT_HASH=$$(find packages/web/src -type f -exec sha256sum {} + 2>/dev/null | sort | sha256sum | cut -d' ' -f1); \
	for f in packages/web/vite.config.ts packages/web/tsconfig.json packages/web/package.json; do \
		CURRENT_HASH="$${CURRENT_HASH}$$(sha256sum "$$f" 2>/dev/null | cut -d' ' -f1)"; \
	done; \
	CURRENT_HASH=$$(echo "$${CURRENT_HASH}" | sha256sum | cut -d' ' -f1); \
	REPO_ROOT=$$(pwd); \
	if [ -f "$(WEB_HASH_FILE)" ] && [ "$$(cat $(WEB_HASH_FILE))" = "$${CURRENT_HASH}" ] && [ -d packages/web/dist ]; then \
		echo "[OK]    web SPA unchanged — skipping rebuild"; \
	else \
		echo "==> Web SPA changed — rebuilding..."; \
		cd packages/web && $(WEB_PATH) pnpm build; \
		echo "$${CURRENT_HASH}" > "$${REPO_ROOT}/$(WEB_HASH_FILE)"; \
	fi

## web-dev: Run admin panel dev server
web-dev:
	cd $(PKG)/web && $(WEB_PATH) pnpm dev

## test-web: Run frontend Vitest tests
test-web:
	cd $(PKG)/web && $(WEB_PATH) pnpm test

## test-web-coverage: Run frontend Vitest tests with coverage
test-web-coverage:
	cd $(PKG)/web && $(WEB_PATH) pnpm test:coverage

## ui-storybook: Run @rioku/ui Storybook at localhost:6006
ui-storybook:
	cd $(PKG)/ui && $(WEB_PATH) npx storybook dev -p 6006

## test-ui: Run @rioku/ui Vitest tests
test-ui:
	cd $(PKG)/ui && $(WEB_PATH) npx vitest run

## clean: Remove build artifacts
clean:
	rm -rf $(BIN_DIR) $(PKG)/proto/gen $(PKG)/web/dist $(PKG)/web/.build-hash $(PKG)/daemon/web/build

## lint-commit: Validate a commit message (usage: make lint-commit MSG="feat: add thing")
lint-commit:
	@.githooks/lint-commit.sh "$(MSG)"

## lint-spell: Run spell checker
lint-spell:
	npx cspell "**/*.{go,md,proto,yaml,yml}" --no-progress

## setup: Set up development environment (installs tools, hooks, dependencies)
setup:
	@./scripts/setup.sh

## hooks: Install git hooks
hooks:
	@echo "Installing git hooks..."
	@git config core.hooksPath .githooks
	@echo "Git hooks installed (.githooks/)"

## dev: Run daemon in development mode
dev: build-daemon
	./$(BIN_DIR)/rioku daemon --dev

# ── Container Sandbox ────────────────────────────────────────
COMPOSE_CMD := $(shell if command -v podman-compose >/dev/null 2>&1; then echo "podman-compose"; elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then echo "docker compose"; elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"; fi)

## sandbox-container: Start sandbox in containers (auto-detects Podman or Docker)
sandbox-container:
	@if [ -z "$(COMPOSE_CMD)" ]; then \
		echo "Error: No container compose tool found. Install podman-compose or docker compose."; exit 1; \
	fi
	@echo "Using: $(COMPOSE_CMD)"
	@cd sandbox && $(COMPOSE_CMD) --env-file .env.example up --build -d
	@echo ""
	@echo "Container sandbox started. Waiting for daemon health..."
	@for i in $$(seq 1 30); do \
		curl -sf http://localhost:$${SANDBOX_PORT_REST:-7778}/api/v1/health >/dev/null 2>&1 && break; \
		sleep 1; \
	done
	@echo "Sandbox ready at http://localhost:$${SANDBOX_PORT_REST:-7778}"

## sandbox-container-stop: Stop container sandbox
sandbox-container-stop:
	@cd sandbox && $(COMPOSE_CMD) down

## sandbox-container-logs: View container sandbox logs
sandbox-container-logs:
	@cd sandbox && $(COMPOSE_CMD) logs -f

## sandbox-container-clean: Remove container sandbox (volumes + images)
sandbox-container-clean:
	@cd sandbox && $(COMPOSE_CMD) down -v --rmi local
