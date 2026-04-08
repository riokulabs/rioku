.PHONY: all build build-daemon build-daemon-lean build-service proto proto-lint test test-race test-security test-raft-cluster test-coverage coverage-baseline lint lint-commit lint-spell clean web web-build web-embed hooks setup sandbox sandbox-stop sandbox-seed sandbox-restart-daemon sandbox-test-auth sandbox-test-smoke sandbox-seed-users help

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

## sandbox: Start sandbox environment
.PHONY: sandbox sandbox-stop sandbox-seed
sandbox: build-daemon
	@bash sandbox/scripts/start.sh

## sandbox-stop: Stop sandbox environment
sandbox-stop:
	@bash sandbox/scripts/stop.sh

## sandbox-seed: Re-seed sandbox configuration
sandbox-seed:
	@echo "Re-seeding not yet implemented (restart sandbox instead)"

## sandbox-restart-daemon: Rebuild daemon + restart without touching upstream apps (~5s)
sandbox-restart-daemon: build-daemon
	@echo "==> Restarting daemon screen session..."
	@if command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -q "rioku-daemon"; then \
	  screen -S rioku-daemon -X quit 2>/dev/null || true; \
	  sleep 1; \
	  screen -dmS rioku-daemon -L -Logfile sandbox/.data/daemon.log \
	    bin/rioku start --config-file sandbox/.data/rioku.yaml; \
	  echo "  daemon restarted in screen session rioku-daemon"; \
	else \
	  echo "  screen not found or rioku-daemon session not running"; \
	  echo "  stop and restart the sandbox with: make sandbox-stop && make sandbox"; \
	  exit 1; \
	fi
	@echo "==> Waiting for daemon health..."
	@for i in $$(seq 1 15); do \
	  if curl -sf --max-time 2 http://localhost:7778/api/v1/health >/dev/null 2>&1; then \
	    echo "[OK]    daemon is healthy"; \
	    exit 0; \
	  fi; \
	  sleep 1; \
	done; \
	echo "[WARN]  daemon did not become healthy in 15s — check sandbox/.data/daemon.log"

## sandbox-test-auth: Run auth smoke tests against running sandbox
sandbox-test-auth:
	@bash sandbox/scripts/test-auth.sh

## sandbox-test-smoke: Run full-stack smoke tests against running sandbox
sandbox-test-smoke:
	@bash sandbox/scripts/test-smoke.sh

## sandbox-seed-users: Seed test users into a running sandbox
sandbox-seed-users:
	@if [ -f sandbox/.data/root-password ]; then \
	  bash sandbox/scripts/seed-users.sh "$$(cat sandbox/.data/root-password)"; \
	else \
	  echo "[FAIL]  sandbox/.data/root-password not found"; \
	  echo "        Run: bash sandbox/scripts/seed-users.sh <root-password>"; \
	  exit 1; \
	fi

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
web-embed: web-build
	@rm -rf $(PKG)/daemon/web/build
	@cp -r $(PKG)/web/build $(PKG)/daemon/web/build

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

## test: Run all tests
test:
	cd $(PKG)/daemon && $(GO) test ./...
	cd $(PKG)/build-service && $(GO) test ./...

## test-race: Run all tests with race detector
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

## lint: Run linters
lint:
	cd $(PKG)/daemon && golangci-lint run ./...
	cd $(PKG)/build-service && golangci-lint run ./...

## web: Install web dependencies
web:
	cd $(PKG)/web && npm install

## web-build: Build the admin panel SPA
web-build:
	cd $(PKG)/web && npm run build

## web-dev: Run admin panel dev server
web-dev:
	cd $(PKG)/web && npm run dev

## clean: Remove build artifacts
clean:
	rm -rf $(BIN_DIR) $(PKG)/proto/gen $(PKG)/web/build

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
