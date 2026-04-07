package wasm

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sync"
	"testing"
)

func loadTestPlugin(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(fmt.Sprintf("testdata/%s.wasm", name))
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return data
}

func TestHostCreateAndClose(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256) // 256 pages = 16MB
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	if err := host.Close(ctx); err != nil {
		t.Fatalf("close host: %v", err)
	}
}

func TestLoadAndInvokePlugin(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer host.Close(ctx)

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	plugin, err := host.LoadPlugin(ctx, "test-plugin", wasmBytes, []byte(`{"key":"value"}`), 2)
	if err != nil {
		t.Fatalf("load plugin: %v", err)
	}

	// Create a request context.
	req, _ := http.NewRequest("GET", "/api/users", nil)
	req.Header.Set("X-Request-ID", "abc123")
	rc := NewRequestContext(req, nil)

	// Invoke the plugin.
	action, err := plugin.HandleRequest(ctx, rc)
	if err != nil {
		t.Fatalf("handle request: %v", err)
	}

	if action != ActionContinue {
		t.Errorf("expected ActionContinue, got %d", action)
	}

	// Verify the plugin set the response header.
	if got := rc.RespHeaders.Get("X-Plugin"); got != "test-v1" {
		t.Errorf("expected X-Plugin=test-v1, got %q", got)
	}

	// Verify the plugin logged a message.
	if len(rc.LogMessages) == 0 {
		t.Error("expected log messages")
	} else if rc.LogMessages[0] != "plugin invoked" {
		t.Errorf("expected 'plugin invoked', got %q", rc.LogMessages[0])
	}

	t.Logf("action=%d, headers=%v, logs=%v", action, rc.RespHeaders, rc.LogMessages)
}

func TestHotSwap(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer host.Close(ctx)

	v1 := loadTestPlugin(t, "plugin_v1")
	v2 := loadTestPlugin(t, "plugin_v2")

	plugin, err := host.LoadPlugin(ctx, "swap-plugin", v1, nil, 2)
	if err != nil {
		t.Fatalf("load v1: %v", err)
	}

	// Invoke v1.
	req1, _ := http.NewRequest("GET", "/test", nil)
	rc1 := NewRequestContext(req1, nil)
	if _, err := plugin.HandleRequest(ctx, rc1); err != nil {
		t.Fatalf("handle v1: %v", err)
	}
	if got := rc1.RespHeaders.Get("X-Plugin"); got != "test-v1" {
		t.Fatalf("expected test-v1, got %q", got)
	}

	// Hot-swap to v2.
	if err := plugin.HotSwap(ctx, v2); err != nil {
		t.Fatalf("hot-swap: %v", err)
	}

	// Invoke v2.
	req2, _ := http.NewRequest("GET", "/test", nil)
	rc2 := NewRequestContext(req2, nil)
	if _, err := plugin.HandleRequest(ctx, rc2); err != nil {
		t.Fatalf("handle v2: %v", err)
	}
	if got := rc2.RespHeaders.Get("X-Plugin"); got != "test-v2" {
		t.Fatalf("expected test-v2, got %q", got)
	}

	t.Log("hot-swap v1->v2 successful")
}

func TestConcurrentRequests(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer host.Close(ctx)

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	plugin, err := host.LoadPlugin(ctx, "concurrent-plugin", wasmBytes, nil, 32)
	if err != nil {
		t.Fatalf("load plugin: %v", err)
	}

	const goroutines = 100
	var wg sync.WaitGroup
	wg.Add(goroutines)
	errs := make([]error, goroutines)

	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			req, _ := http.NewRequest("GET", fmt.Sprintf("/path/%d", idx), nil)
			rc := NewRequestContext(req, nil)
			_, errs[idx] = plugin.HandleRequest(ctx, rc)
			if errs[idx] == nil && rc.RespHeaders.Get("X-Plugin") != "test-v1" {
				errs[idx] = fmt.Errorf("goroutine %d: wrong header %q", idx, rc.RespHeaders.Get("X-Plugin"))
			}
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("goroutine %d: %v", i, err)
		}
	}

	stats := plugin.pool.Stats()
	t.Logf("pool stats: free=%d inUse=%d created=%d capacity=%d",
		stats.Free, stats.InUse, stats.Created, stats.Capacity)
}

func TestUnloadPlugin(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer host.Close(ctx)

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	_, err = host.LoadPlugin(ctx, "unload-me", wasmBytes, nil, 2)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if _, ok := host.GetPlugin("unload-me"); !ok {
		t.Fatal("plugin should exist")
	}

	if err := host.UnloadPlugin(ctx, "unload-me"); err != nil {
		t.Fatalf("unload: %v", err)
	}

	if _, ok := host.GetPlugin("unload-me"); ok {
		t.Fatal("plugin should not exist after unload")
	}
}

func TestPoolDrain(t *testing.T) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	defer host.Close(ctx)

	wasmBytes := loadTestPlugin(t, "plugin_v1")
	plugin, err := host.LoadPlugin(ctx, "drain-plugin", wasmBytes, nil, 4)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	// Acquire an instance (simulating in-flight request).
	inst, err := plugin.pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	// Start draining in background.
	done := make(chan struct{})
	go func() {
		plugin.pool.Drain(ctx)
		close(done)
	}()

	// Release the instance — drain should complete.
	plugin.pool.Release(inst)

	<-done
	t.Log("pool drained successfully after in-flight release")
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

func BenchmarkHandleRequest(b *testing.B) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		b.Fatalf("create host: %v", err)
	}
	defer host.Close(ctx)

	wasmBytes, err := os.ReadFile("testdata/plugin_v1.wasm")
	if err != nil {
		b.Fatalf("load: %v", err)
	}
	plugin, err := host.LoadPlugin(ctx, "bench-plugin", wasmBytes, nil, 4)
	if err != nil {
		b.Fatalf("load: %v", err)
	}

	req, _ := http.NewRequest("GET", "/bench", nil)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rc := NewRequestContext(req, nil)
		plugin.HandleRequest(ctx, rc)
	}
}

func BenchmarkHandleRequestParallel(b *testing.B) {
	ctx := context.Background()
	host, err := NewHost(ctx, 256)
	if err != nil {
		b.Fatalf("create host: %v", err)
	}
	defer host.Close(ctx)

	wasmBytes, err := os.ReadFile("testdata/plugin_v1.wasm")
	if err != nil {
		b.Fatalf("load: %v", err)
	}
	plugin, err := host.LoadPlugin(ctx, "bench-par-plugin", wasmBytes, nil, 32)
	if err != nil {
		b.Fatalf("load: %v", err)
	}

	req, _ := http.NewRequest("GET", "/bench", nil)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			rc := NewRequestContext(req, nil)
			plugin.HandleRequest(ctx, rc)
		}
	})
}

// BenchmarkNativeGoBaseline is the same logic as the WASM plugin but in pure Go.
// This establishes the baseline to quantify WASM overhead.
func BenchmarkNativeGoBaseline(b *testing.B) {
	req, _ := http.NewRequest("GET", "/bench", nil)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rc := NewRequestContext(req, nil)
		// Same operations the WASM plugin does:
		_ = rc.Path // read path
		rc.RespHeaders.Set("X-Plugin", "test-v1")
		rc.LogMessages = append(rc.LogMessages, "plugin invoked")
	}
}
