# Graceful Degradation (Minimal v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the config store goes offline, the daemon serves cached config for reads and rejects writes with an error, instead of failing all API requests.

**Architecture:** Add a `cachedSnapshot` field to `config.Engine`. After every successful `buildSnapshot` call, cache the result. On read failures, return the cached snapshot. On write failures, return the error (no write-through cache). The `Health()` method on the engine (if it exists) or a new `Degraded()` method reports when serving from cache.

**Tech Stack:** Go 1.24, config.Engine, store.Driver

**Working directory:** `packages/daemon`

**Spec:** `docs/superpowers/specs/2026-04-12-rest-api-endpoints.md` (section #123)

**Key conventions:**
- Go standard library preferred, no external test libraries
- Table-driven tests, real databases for integration tests
- Handle every error explicitly, `-race` flag on all tests
- Conventional Commits required, no AI references in commits
- TDD: write test first, verify it fails, then implement

---

## Task 1: Add cachedSnapshot field and cache-on-success behavior

**Files:**
- Modify: `packages/daemon/internal/config/engine.go`
- Modify: `packages/daemon/internal/config/engine_test.go`

- [ ] **Step 1: Write test for cache updated on success**

Add to `packages/daemon/internal/config/engine_test.go`:

```go
func TestEngine_CacheUpdatedOnSuccess(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	// First call should succeed and populate the cache.
	snap, err := e.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if snap == nil {
		t.Fatal("expected non-nil snapshot")
	}

	// The cache should now be populated.
	cached := e.CachedSnapshot()
	if cached == nil {
		t.Fatal("expected cached snapshot after successful GetConfig")
	}
	if cached.GetVersion() != snap.GetVersion() {
		t.Errorf("cached version = %d, want %d", cached.GetVersion(), snap.GetVersion())
	}
}
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/config/ -run "TestEngine_CacheUpdatedOnSuccess"
```

Expected: FAIL — `CachedSnapshot` method doesn't exist.

- [ ] **Step 3: Add cachedSnapshot field and CachedSnapshot method**

In `packages/daemon/internal/config/engine.go`, add the field to the `Engine` struct:

```go
type Engine struct {
	store           store.Driver
	compiler        *caddy.Compiler
	mu              sync.RWMutex
	cachedSnapshot  *riokuv1.ConfigSnapshot
}
```

Add a public accessor:

```go
// CachedSnapshot returns the last successfully-read config snapshot, or nil
// if no successful read has occurred yet.
func (e *Engine) CachedSnapshot() *riokuv1.ConfigSnapshot {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.cachedSnapshot
}
```

- [ ] **Step 4: Update GetConfig to cache on success**

In `packages/daemon/internal/config/engine.go`, in `GetConfig`, after the successful `buildSnapshot` and before the return, add:

```go
	// Cache the snapshot for degraded-mode fallback.
	e.mu.Lock()
	e.cachedSnapshot = snap
	e.mu.Unlock()
```

- [ ] **Step 5: Run test**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/config/ -run "TestEngine_CacheUpdatedOnSuccess"
```

Expected: PASS

- [ ] **Step 6: Commit**

```
feat(config): cache config snapshot on successful reads
```

---

## Task 2: Cache fallback on read failure

**Files:**
- Modify: `packages/daemon/internal/config/engine.go`
- Modify: `packages/daemon/internal/config/engine_test.go`

- [ ] **Step 1: Write tests for cache fallback behavior**

These tests need a way to simulate store failure. The approach: create a normal engine, do a successful read (populates cache), then close the store to simulate failure.

Add to `engine_test.go`:

```go
func TestEngine_CacheFallback_Read(t *testing.T) {
	ctx := context.Background()

	// Create engine with a real store.
	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "fallback.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{DevMode: true}, "", nil, caddy.SecurityHeadersConfig{})
	e := NewEngine(drv, compiler)

	// Successful read — populates cache.
	snap1, err := e.GetConfig(ctx)
	if err != nil {
		t.Fatalf("first GetConfig: %v", err)
	}
	if snap1 == nil {
		t.Fatal("expected non-nil snapshot")
	}

	// Close store to simulate failure.
	if err := drv.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	// Read should fall back to cache.
	snap2, err := e.GetConfig(ctx)
	if err != nil {
		t.Fatalf("fallback GetConfig should succeed with cache, got: %v", err)
	}
	if snap2 == nil {
		t.Fatal("expected cached snapshot, got nil")
	}
	if snap2.GetVersion() != snap1.GetVersion() {
		t.Errorf("fallback version = %d, want %d", snap2.GetVersion(), snap1.GetVersion())
	}
}

func TestEngine_CacheFallback_NoCacheYet(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "nocache.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{DevMode: true}, "", nil, caddy.SecurityHeadersConfig{})
	e := NewEngine(drv, compiler)

	// Close store BEFORE any successful read.
	if err := drv.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	// Should fail — no cache available.
	_, err = e.GetConfig(ctx)
	if err == nil {
		t.Fatal("expected error when store is down and no cache exists")
	}
}

func TestEngine_CacheFallback_Write(t *testing.T) {
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "writefail.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{DevMode: true}, "", nil, caddy.SecurityHeadersConfig{})
	e := NewEngine(drv, compiler)

	// Populate cache with a successful read.
	_, err = e.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}

	// Close store.
	if err := drv.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	// Write should fail (no write-through cache).
	change := &riokuv1.ConfigChange{
		EntityType: riokuv1.EntityType_ENTITY_TYPE_SERVICE,
		Operation:  riokuv1.Operation_OPERATION_CREATE,
		Entity: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.Service{
				Name: "fail-svc",
			},
		},
	}
	_, err = e.ApplyChange(ctx, change, "test")
	if err == nil {
		t.Fatal("expected error on write when store is down")
	}
}
```

Ensure `filepath` is imported.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/config/ -run "TestEngine_CacheFallback"
```

Expected: `TestEngine_CacheFallback_Read` fails (GetConfig returns error, doesn't fall back to cache). The other two may pass or fail depending on how errors propagate.

- [ ] **Step 3: Add cache fallback to GetConfig**

In `packages/daemon/internal/config/engine.go`, modify `GetConfig` to fall back to the cache on error:

Replace the current `GetConfig` implementation. The key change: wrap the store read in error handling that falls back to cached data:

```go
func (e *Engine) GetConfig(ctx context.Context) (*riokuv1.ConfigSnapshot, error) {
	tx, err := e.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		// Store unavailable — try cache.
		e.mu.RLock()
		cached := e.cachedSnapshot
		e.mu.RUnlock()
		if cached != nil {
			return cached, nil
		}
		return nil, fmt.Errorf("config: store unavailable and no cached snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	snap, err := buildSnapshot(ctx, tx)
	if err != nil {
		// Build failed — try cache.
		e.mu.RLock()
		cached := e.cachedSnapshot
		e.mu.RUnlock()
		if cached != nil {
			return cached, nil
		}
		return nil, fmt.Errorf("config: %w", err)
	}

	if err := tx.Commit(); err != nil {
		e.mu.RLock()
		cached := e.cachedSnapshot
		e.mu.RUnlock()
		if cached != nil {
			return cached, nil
		}
		return nil, fmt.Errorf("config: commit: %w", err)
	}

	// Cache the successful snapshot.
	e.mu.Lock()
	e.cachedSnapshot = snap
	e.mu.Unlock()

	return snap, nil
}
```

- [ ] **Step 4: Run fallback tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/config/ -run "TestEngine_CacheFallback"
```

Expected: All 3 PASS.

- [ ] **Step 5: Run full config test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race -v ./internal/config/
```

Expected: All pass, no regressions.

- [ ] **Step 6: Commit**

```
feat(config): add cache fallback for config reads when store is offline
```

---

## Task 3: Full verification

- [ ] **Step 1: Run complete daemon test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && go test -race ./...
```

Expected: All pass.

- [ ] **Step 2: Verify build**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku && make build-daemon
```

Expected: Binary builds cleanly.

- [ ] **Step 3: Commit (if any fixups needed)**

---

## Summary of all files modified

### Modified:
- `packages/daemon/internal/config/engine.go` — `cachedSnapshot` field, `CachedSnapshot()` accessor, cache-on-success in `GetConfig`, fallback logic in `GetConfig`
- `packages/daemon/internal/config/engine_test.go` — 4 new test functions

### Commits (2-3 total):
1. `feat(config): cache config snapshot on successful reads`
2. `feat(config): add cache fallback for config reads when store is offline`
3. (optional) fixup from full verification
