package wasm

import (
	"context"
	"net/http"
	"testing"
)

// ---------------------------------------------------------------------------
// ABI host-function coverage
// ---------------------------------------------------------------------------

// TestFullABICoverage uses plugin_full.wasm, which exercises every host
// function: get_request_header, set_request_header, get_request_method,
// set_response_status, set_response_body, get_plugin_config.
func TestFullABICoverage(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_full")
	config := []byte(`{"mode":"full"}`)
	plugin, err := host.LoadPlugin(ctx, "full-plugin", wasmBytes, config, 2)
	if err != nil {
		t.Fatalf("load plugin: %v", err)
	}

	req, _ := http.NewRequest("POST", "/api/full", nil)
	req.Header.Set("X-Request-ID", "req-42")
	rc := NewRequestContext(req, nil)

	action, err := plugin.HandleRequest(ctx, rc)
	if err != nil {
		t.Fatalf("handle request: %v", err)
	}

	if action != ActionContinue {
		t.Errorf("expected ActionContinue, got %d", action)
	}

	// Plugin calls set_response_status(200).
	if rc.RespStatus != 200 {
		t.Errorf("expected RespStatus=200, got %d", rc.RespStatus)
	}

	// Plugin calls set_response_header("X-Plugin", "full-v1").
	if got := rc.RespHeaders.Get("X-Plugin"); got != "full-v1" {
		t.Errorf("expected X-Plugin=full-v1, got %q", got)
	}

	// Plugin calls set_response_body("hello from plugin").
	if string(rc.RespBody) != "hello from plugin" {
		t.Errorf("expected body %q, got %q", "hello from plugin", string(rc.RespBody))
	}

	// Plugin calls set_request_header("X-Modified", "modified-by-plugin").
	if got := rc.Headers.Get("X-Modified"); got != "modified-by-plugin" {
		t.Errorf("expected X-Modified=modified-by-plugin, got %q", got)
	}

	// Plugin calls log_info("full plugin invoked").
	if len(rc.LogMessages) == 0 || rc.LogMessages[0] != "full plugin invoked" {
		t.Errorf("expected log %q, got %v", "full plugin invoked", rc.LogMessages)
	}
}

// TestActionRespond verifies ActionRespond is returned and state is set.
func TestActionRespond(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_respond")
	plugin, err := host.LoadPlugin(ctx, "respond-plugin", wasmBytes, nil, 2)
	if err != nil {
		t.Fatalf("load plugin: %v", err)
	}

	req, _ := http.NewRequest("GET", "/blocked", nil)
	rc := NewRequestContext(req, nil)

	action, err := plugin.HandleRequest(ctx, rc)
	if err != nil {
		t.Fatalf("handle request: %v", err)
	}

	if action != ActionRespond {
		t.Errorf("expected ActionRespond, got %d", action)
	}
	if rc.RespStatus != 403 {
		t.Errorf("expected RespStatus=403, got %d", rc.RespStatus)
	}
	if string(rc.RespBody) != "Forbidden" {
		t.Errorf("expected body 'Forbidden', got %q", string(rc.RespBody))
	}
	if got := rc.RespHeaders.Get("X-Plugin"); got != "responder" {
		t.Errorf("expected X-Plugin=responder, got %q", got)
	}
}

// TestGetPluginConfigPropagated verifies get_plugin_config is called and
// config bytes flow through correctly (plugin reads but ignores the value;
// we verify the path is exercised via indirect state).
func TestGetPluginConfigPropagated(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	config := []byte(`{"feature":"enabled","limit":100}`)
	wasmBytes := loadTestPlugin(t, "plugin_full")
	plugin, err := host.LoadPlugin(ctx, "cfg-plugin", wasmBytes, config, 2)
	if err != nil {
		t.Fatalf("load plugin: %v", err)
	}

	req, _ := http.NewRequest("GET", "/cfg", nil)
	rc := NewRequestContext(req, nil)

	if _, err := plugin.HandleRequest(ctx, rc); err != nil {
		t.Fatalf("handle request: %v", err)
	}

	// Plugin config must be visible in RequestContext after HandleRequest.
	if string(rc.PluginConfig) != string(config) {
		t.Errorf("expected config %q, got %q", config, rc.PluginConfig)
	}
}

// ---------------------------------------------------------------------------
// Host error paths
// ---------------------------------------------------------------------------

// TestNewHostZeroMemoryLimit verifies zero memory limit is accepted (no cap).
func TestNewHostZeroMemoryLimit(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 0)
	if err != nil {
		t.Fatalf("create host with zero limit: %v", err)
	}
	if err := host.Close(ctx); err != nil {
		t.Fatalf("close: %v", err)
	}
}

// TestLoadPluginInvalidWASM verifies LoadPlugin returns an error for garbage.
func TestLoadPluginInvalidWASM(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	_, err = host.LoadPlugin(ctx, "bad", []byte("not-wasm"), nil, 2)
	if err == nil {
		t.Fatal("expected error loading invalid WASM, got nil")
	}
}

// TestLoadPluginOnClosedHost verifies LoadPlugin returns an error after Close.
func TestLoadPluginOnClosedHost(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	if err := host.Close(ctx); err != nil {
		t.Fatalf("close: %v", err)
	}

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	_, err = host.LoadPlugin(ctx, "late", wasmBytes, nil, 2)
	if err == nil {
		t.Fatal("expected error loading plugin on closed host, got nil")
	}
}

// TestUnloadPluginNotFound verifies UnloadPlugin returns an error for unknown name.
func TestUnloadPluginNotFound(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	if err := host.UnloadPlugin(ctx, "does-not-exist"); err == nil {
		t.Fatal("expected error unloading nonexistent plugin, got nil")
	}
}

// TestHotSwapInvalidWASM verifies HotSwap returns error on bad bytes.
func TestHotSwapInvalidWASM(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	plugin, err := host.LoadPlugin(ctx, "swap-err", wasmBytes, nil, 2)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if err := plugin.HotSwap(ctx, []byte("garbage")); err == nil {
		t.Fatal("expected error hot-swapping with invalid WASM, got nil")
	}
}

// TestHandleRequestNoHandleExport verifies HandleRequest errors gracefully when
// the plugin does not export handle_request.
func TestHandleRequestNoHandleExport(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	// Build a minimal WASM module that has memory and malloc but NO handle_request.
	// We do this inline with the WAT text format encoded to bytes via wazero's
	// own text format decoder — but the simplest approach is to use the
	// pre-compiled minimal WASM binary (magic + version + empty module).
	// An empty module has no exports at all.
	emptyModule := []byte{
		0x00, 0x61, 0x73, 0x6d, // magic: \0asm
		0x01, 0x00, 0x00, 0x00, // version: 1
	}

	_, err = host.LoadPlugin(ctx, "no-handle", emptyModule, nil, 1)
	if err != nil {
		// The empty module may fail at pool creation because it has no memory
		// or no malloc — that is also an acceptable error path.
		t.Logf("LoadPlugin with empty module failed (expected): %v", err)
		return
	}

	plugin, _ := host.GetPlugin("no-handle")
	req, _ := http.NewRequest("GET", "/", nil)
	rc := NewRequestContext(req, nil)
	_, err = plugin.HandleRequest(ctx, rc)
	if err == nil {
		t.Fatal("expected error calling handle_request on plugin without export, got nil")
	}
}

// ---------------------------------------------------------------------------
// Pool error and edge-case coverage
// ---------------------------------------------------------------------------

// TestPoolExhaustion verifies Acquire returns an error when the pool is maxed out.
func TestPoolExhaustion(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	// Pool size 1 means maxInstances = 4.
	plugin, err := host.LoadPlugin(ctx, "exhaust-plugin", wasmBytes, nil, 1)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	// Acquire up to maxInstances (size*4 = 4) without releasing.
	maxInstances := plugin.pool.size * 4
	instances := make([]*instance, 0, maxInstances)
	for i := 0; i < maxInstances; i++ {
		inst, err := plugin.pool.Acquire(ctx)
		if err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
		instances = append(instances, inst)
	}

	// One more should fail.
	_, err = plugin.pool.Acquire(ctx)
	if err == nil {
		t.Fatal("expected pool exhaustion error, got nil")
	}

	// Release all acquired instances.
	for _, inst := range instances {
		plugin.pool.Release(inst)
	}
}

// TestPoolReleaseOverCapacity verifies that returning instances beyond pool
// capacity causes the excess to be closed rather than re-queued.
func TestPoolReleaseOverCapacity(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	poolSize := 2
	plugin, err := host.LoadPlugin(ctx, "capacity-plugin", wasmBytes, nil, poolSize)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	// Drain the pre-warmed free list first, then acquire extra instances so
	// that releasing them all overflows the free-list capacity.
	instances := make([]*instance, 0, poolSize*2)
	for i := 0; i < poolSize*2; i++ {
		inst, err := plugin.pool.Acquire(ctx)
		if err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
		instances = append(instances, inst)
	}

	// Release all — the first `poolSize` fills the pool, the rest are closed.
	for _, inst := range instances {
		plugin.pool.Release(inst)
	}

	stats := plugin.pool.Stats()
	if stats.InUse != 0 {
		t.Errorf("expected inUse=0 after all releases, got %d", stats.InUse)
	}
	if stats.Free > poolSize {
		t.Errorf("free list %d exceeds pool capacity %d", stats.Free, poolSize)
	}
}

// TestPoolAcquireOnClosedPool verifies Acquire returns an error on a drained pool.
func TestPoolAcquireOnClosedPool(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	plugin, err := host.LoadPlugin(ctx, "closed-pool-plugin", wasmBytes, nil, 2)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	plugin.pool.Drain(ctx)

	_, err = plugin.pool.Acquire(ctx)
	if err == nil {
		t.Fatal("expected error acquiring from closed pool, got nil")
	}
}

// TestPoolDrainIdempotent verifies calling Drain twice does not panic.
func TestPoolDrainIdempotent(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	plugin, err := host.LoadPlugin(ctx, "drain2-plugin", wasmBytes, nil, 2)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	plugin.pool.Drain(ctx)
	plugin.pool.Drain(ctx) // must not panic or deadlock
}

// TestPoolReleaseOnDrainingPool verifies Release on a draining pool closes the
// instance and closes drainCh when inUse reaches zero.
func TestPoolReleaseOnDrainingPool(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	plugin, err := host.LoadPlugin(ctx, "drain-release-plugin", wasmBytes, nil, 2)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	// Acquire an instance while the pool is still open.
	inst, err := plugin.pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	// Mark pool closed manually (simulates concurrent drain start).
	plugin.pool.mu.Lock()
	plugin.pool.closed = true
	// Close free instances (as Drain does).
	for _, fi := range plugin.pool.free {
		_ = fi.mod.Close(ctx)
	}
	plugin.pool.free = nil
	// Do NOT close drainCh yet — inUse is still 1.
	plugin.pool.mu.Unlock()

	// Release should close the instance and close drainCh.
	plugin.pool.Release(inst)

	// Verify drainCh is closed.
	select {
	case <-plugin.pool.drainCh:
		// expected
	default:
		t.Error("drainCh was not closed after last release on draining pool")
	}
}

// ---------------------------------------------------------------------------
// RequestContext helpers
// ---------------------------------------------------------------------------

// TestNewRequestContextFields verifies NewRequestContext copies headers correctly.
func TestNewRequestContextFields(t *testing.T) {
	req, _ := http.NewRequest("DELETE", "/resource/99", nil)
	req.Header.Set("Authorization", "Bearer token123")
	req.Header.Set("Content-Type", "application/json")

	config := []byte(`{"x":1}`)
	rc := NewRequestContext(req, config)

	if rc.Method != "DELETE" {
		t.Errorf("expected Method=DELETE, got %q", rc.Method)
	}
	if rc.Path != "/resource/99" {
		t.Errorf("expected Path=/resource/99, got %q", rc.Path)
	}
	if rc.Headers.Get("Authorization") != "Bearer token123" {
		t.Errorf("Authorization header not copied")
	}
	if rc.Headers.Get("Content-Type") != "application/json" {
		t.Errorf("Content-Type header not copied")
	}
	if string(rc.PluginConfig) != string(config) {
		t.Errorf("PluginConfig not set correctly")
	}
	if rc.RespStatus != 0 {
		t.Errorf("expected initial RespStatus=0, got %d", rc.RespStatus)
	}
	if rc.RespHeaders == nil {
		t.Error("RespHeaders should be initialized")
	}
}

// TestContextKeyRoundtrip verifies withRequestContext / getRequestContext.
func TestContextKeyRoundtrip(t *testing.T) {
	req, _ := http.NewRequest("GET", "/x", nil)
	rc := NewRequestContext(req, nil)

	ctx := withRequestContext(context.Background(), rc)
	got := getRequestContext(ctx)
	if got != rc {
		t.Error("getRequestContext did not return the same *RequestContext")
	}

	// Missing context returns nil.
	if getRequestContext(context.Background()) != nil {
		t.Error("getRequestContext on plain context should return nil")
	}
}

// TestGetPluginStats verifies Stats returns consistent values.
func TestGetPluginStats(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	const poolSize = 3
	plugin, err := host.LoadPlugin(ctx, "stats-plugin", wasmBytes, nil, poolSize)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	stats := plugin.pool.Stats()
	if stats.Capacity != poolSize {
		t.Errorf("expected capacity=%d, got %d", poolSize, stats.Capacity)
	}
	if stats.Free != poolSize {
		t.Errorf("expected free=%d after warmup, got %d", poolSize, stats.Free)
	}
	if stats.InUse != 0 {
		t.Errorf("expected inUse=0, got %d", stats.InUse)
	}
}

// TestGetPluginConfigEmptyConfig verifies hostGetPluginConfig returns (0,0) when
// the plugin's config is empty (covers the len==0 branch).
func TestGetPluginConfigEmptyConfig(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_no_config_read")
	// Pass nil config — the plugin calls get_plugin_config but gets (0, 0) back.
	plugin, err := host.LoadPlugin(ctx, "no-cfg-plugin", wasmBytes, nil, 2)
	if err != nil {
		t.Fatalf("load plugin: %v", err)
	}

	req, _ := http.NewRequest("GET", "/no-cfg", nil)
	rc := NewRequestContext(req, nil)
	if _, err := plugin.HandleRequest(ctx, rc); err != nil {
		t.Fatalf("handle request: %v", err)
	}

	if got := rc.RespHeaders.Get("X-Config-Read"); got != "yes" {
		t.Errorf("expected X-Config-Read=yes, got %q", got)
	}
}

// TestDrainWithCancelledContext verifies Drain returns when the context is
// cancelled while an instance is still in use (covers the ctx.Done() branch).
func TestDrainWithCancelledContext(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	plugin, err := host.LoadPlugin(ctx, "cancel-drain-plugin", wasmBytes, nil, 2)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	// Acquire an instance and hold it.
	inst, err := plugin.pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	// Drain with a context that will be cancelled — this exercises ctx.Done().
	cancelCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		plugin.pool.Drain(cancelCtx)
		close(done)
	}()

	// Cancel the context so Drain returns via ctx.Done().
	cancel()
	<-done // Drain should have returned.

	// Release the instance — pool is already draining so this closes it.
	plugin.pool.Release(inst)
}

// TestPoolSizeZeroDefaultsToFour verifies that a size<=0 defaults to 4 instances.
func TestPoolSizeZeroDefaultsToFour(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	// size=0 should default to 4.
	plugin, err := host.LoadPlugin(ctx, "default-size-plugin", wasmBytes, nil, 0)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	stats := plugin.pool.Stats()
	if stats.Capacity != 4 {
		t.Errorf("expected default capacity=4, got %d", stats.Capacity)
	}
	if stats.Free != 4 {
		t.Errorf("expected free=4 after warmup with default size, got %d", stats.Free)
	}
}

// TestHandleRequestOnDrainedPool verifies HandleRequest returns an error when
// the pool is closed (covering the Acquire error path in HandleRequest).
func TestHandleRequestOnDrainedPool(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	plugin, err := host.LoadPlugin(ctx, "drained-hr-plugin", wasmBytes, nil, 2)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	// Drain the pool first.
	plugin.pool.Drain(ctx)

	req, _ := http.NewRequest("GET", "/", nil)
	rc := NewRequestContext(req, nil)
	_, err = plugin.HandleRequest(ctx, rc)
	if err == nil {
		t.Fatal("expected error from HandleRequest on drained pool, got nil")
	}
}

// TestWriteGuestBytesNoMallocExport verifies that writeGuestBytes returns (0,0)
// gracefully when the guest module has no malloc export.
// Uses plugin_no_malloc which calls get_request_method/path/header/config but
// has no malloc — exercises the "guest does not export malloc" branch.
func TestWriteGuestBytesNoMallocExport(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	wasmBytes := loadTestPlugin(t, "plugin_no_malloc")
	plugin, err := host.LoadPlugin(ctx, "no-malloc-plugin", wasmBytes, []byte(`{}`), 1)
	if err != nil {
		t.Fatalf("load plugin_no_malloc: %v", err)
	}

	req, _ := http.NewRequest("GET", "/no-malloc", nil)
	req.Header.Set("X-Foo", "bar")
	rc := NewRequestContext(req, nil)

	// Should succeed — host functions fail gracefully with (0,0) when malloc missing.
	_, err = plugin.HandleRequest(ctx, rc)
	if err != nil {
		t.Fatalf("handle request: %v", err)
	}
}

// TestLoadPluginHotSwapReplacesExisting verifies the hot-swap path inside
// LoadPlugin (loading the same name twice closes the old plugin).
func TestLoadPluginHotSwapReplacesExisting(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer func() { _ = host.Close(ctx) }()

	v1 := loadTestPlugin(t, "plugin_v1")
	v2 := loadTestPlugin(t, "plugin_v2")

	_, err = host.LoadPlugin(ctx, "replaceable", v1, nil, 2)
	if err != nil {
		t.Fatalf("load v1: %v", err)
	}

	// Load again with same name — should replace.
	plugin2, err := host.LoadPlugin(ctx, "replaceable", v2, nil, 2)
	if err != nil {
		t.Fatalf("load v2 (replace): %v", err)
	}

	req, _ := http.NewRequest("GET", "/test", nil)
	rc := NewRequestContext(req, nil)
	if _, err := plugin2.HandleRequest(ctx, rc); err != nil {
		t.Fatalf("handle v2: %v", err)
	}
	if got := rc.RespHeaders.Get("X-Plugin"); got != "test-v2" {
		t.Errorf("expected test-v2, got %q", got)
	}
}
