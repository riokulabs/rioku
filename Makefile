.PHONY: all build build-daemon build-service proto proto-lint test test-race lint lint-commit lint-spell clean web web-build hooks help

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

## help: Show this help message
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //' | column -t -s ':'

## all: Build everything
all: proto build web-build

## build: Build daemon and CLI (same binary)
build: build-daemon

## build-daemon: Build the rioku daemon binary
build-daemon:
	cd $(PKG)/daemon && $(GO) build -ldflags "$(LDFLAGS)" -o ../../$(BIN_DIR)/rioku ./cmd/rioku

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
	rm -rf $(BIN_DIR) $(PKG)/proto/gen $(PKG)/web/build $(PKG)/web/.svelte-kit

## lint-commit: Validate a commit message (usage: make lint-commit MSG="feat: add thing")
lint-commit:
	@.githooks/lint-commit.sh "$(MSG)"

## lint-spell: Run spell checker
lint-spell:
	npx cspell "**/*.{go,md,proto,yaml,yml}" --no-progress

## hooks: Install git hooks
hooks:
	@echo "Installing git hooks..."
	@git config core.hooksPath .githooks
	@echo "Git hooks installed (.githooks/)"

## dev: Run daemon in development mode
dev: build-daemon
	./$(BIN_DIR)/rioku daemon --dev
