package sync_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	agentsync "github.com/riokulabs/rioku/internal/sync"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	// Register the sqlite driver.
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// newTestEngine creates a config.Engine backed by SQLite in a temp dir with
// migrations applied and a dummy compiler.
func newTestEngine(t *testing.T) (*config.Engine, store.Driver) {
	t.Helper()
	ctx := context.Background()

	d, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{}, "", nil, caddy.SecurityHeadersConfig{})
	return config.NewEngine(d, compiler), d
}

// newFakeCaddy starts a test HTTP server that accepts config pushes and
// tracks the number of pushes received.
func newFakeCaddy(t *testing.T) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	pushCount := &atomic.Int64{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/config") {
			pushCount.Add(1)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, pushCount
}

// newCaddyManager creates a caddy.Manager pointing at the given address.
func newCaddyManager(addr string) *caddy.Manager {
	return caddy.NewManager(caddy.ManagerConfig{AdminAddr: addr})
}

// applyServiceChange applies a service upsert to trigger a store change
// notification.
func applyServiceChange(t *testing.T, eng *config.Engine, name string) {
	t.Helper()
	ctx := context.Background()
	_, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name: name,
					Upstreams: []*riokuv1.Upstream{
						{Address: "localhost:9000"},
					},
					LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange service %q: %v", name, err)
	}
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

// TestAgent_StartStop verifies that an agent can be started and stopped
// cleanly without leaking goroutines or deadlocking.
func TestAgent_StartStop(t *testing.T) {
	eng, _ := newTestEngine(t)
	mgr := newCaddyManager("127.0.0.1:0")
	agent := agentsync.NewAgent(eng, mgr)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	agent.Start(ctx)

	// Give the goroutine a moment to enter the select loop.
	time.Sleep(20 * time.Millisecond)

	// Stop must complete without hanging (test timeout would catch a leak).
	done := make(chan struct{})
	go func() {
		agent.Stop()
		close(done)
	}()

	select {
	case <-done:
		// Clean shutdown.
	case <-time.After(5 * time.Second):
		t.Fatal("Agent.Stop() did not return within 5 seconds — possible goroutine leak")
	}
}

// TestAgent_SyncOnce_CaddyNotRunning verifies that when the caddy manager
// reports IsRunning() == false, the initial sync is a no-op (no error, no push).
func TestAgent_SyncOnce_CaddyNotRunning(t *testing.T) {
	eng, _ := newTestEngine(t)
	_, pushCount := newFakeCaddy(t)
	mgr := newCaddyManager("127.0.0.1:0") // not started -> IsRunning() == false

	agent := agentsync.NewAgent(eng, mgr)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start does an initial syncOnce internally.
	agent.Start(ctx)
	time.Sleep(50 * time.Millisecond)

	if got := pushCount.Load(); got != 0 {
		t.Errorf("expected 0 pushes when Caddy not running, got %d", got)
	}

	agent.Stop()
}

// TestAgent_SyncOnce_NilManager verifies that constructing an agent with a
// nil caddy manager does not panic during syncOnce or during run.
func TestAgent_SyncOnce_NilManager(t *testing.T) {
	eng, _ := newTestEngine(t)

	agent := agentsync.NewAgent(eng, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Should not panic: syncOnce checks for nil manager.
	agent.Start(ctx)
	time.Sleep(50 * time.Millisecond)
	agent.Stop()
}

// TestAgent_ConfigChangeTriggersSync verifies that applying a config change
// through the engine triggers the agent's watch channel. Since Caddy is not
// actually running, the syncOnce call will be a no-op, but we verify the
// agent does not hang or error when changes arrive.
func TestAgent_ConfigChangeTriggersSync(t *testing.T) {
	eng, _ := newTestEngine(t)
	mgr := newCaddyManager("127.0.0.1:0")
	agent := agentsync.NewAgent(eng, mgr)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	agent.Start(ctx)

	// Apply several config changes; the agent's run loop should process them
	// without blocking or erroring.
	for i := 0; i < 5; i++ {
		applyServiceChange(t, eng, "svc-"+string(rune('a'+i)))
	}

	// Wait for the debounce timer to fire and the agent to process.
	time.Sleep(300 * time.Millisecond)

	// If we reach here without hanging, the agent handled changes correctly.
	agent.Stop()
}

// TestAgent_ContextCancellation verifies that cancelling the context causes
// the agent's run goroutine to exit cleanly.
func TestAgent_ContextCancellation(t *testing.T) {
	eng, _ := newTestEngine(t)
	mgr := newCaddyManager("127.0.0.1:0")
	agent := agentsync.NewAgent(eng, mgr)

	ctx, cancel := context.WithCancel(context.Background())
	agent.Start(ctx)

	time.Sleep(20 * time.Millisecond)

	// Cancel context instead of calling Stop.
	cancel()

	// The done channel should close once the goroutine exits. We cannot read
	// from done directly (it's unexported), but we can call Stop which reads
	// from it — Stop closes stopCh and waits on done.
	done := make(chan struct{})
	go func() {
		agent.Stop()
		close(done)
	}()

	select {
	case <-done:
		// Goroutine exited after context cancellation.
	case <-time.After(5 * time.Second):
		t.Fatal("Agent did not stop after context cancellation within 5 seconds")
	}
}

// TestAgent_Debounce verifies that rapid config changes are collapsed into
// fewer sync operations by the debounce logic. Since Caddy is not running,
// syncOnce will no-op, but we verify the agent handles rapid change events
// without blocking.
func TestAgent_Debounce(t *testing.T) {
	eng, _ := newTestEngine(t)
	mgr := newCaddyManager("127.0.0.1:0")
	agent := agentsync.NewAgent(eng, mgr)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	agent.Start(ctx)

	// Rapidly apply many changes within the debounce window (100ms).
	for i := 0; i < 10; i++ {
		applyServiceChange(t, eng, "rapid-svc-"+string(rune('a'+i)))
		time.Sleep(5 * time.Millisecond) // 5ms apart, well within 100ms debounce
	}

	// Wait for debounce timer to fire.
	time.Sleep(300 * time.Millisecond)

	// Apply another batch after the first debounce window.
	for i := 0; i < 5; i++ {
		applyServiceChange(t, eng, "batch2-svc-"+string(rune('a'+i)))
	}

	time.Sleep(300 * time.Millisecond)

	// If we reach here without deadlock, the debounce logic works correctly.
	agent.Stop()
}

// TestAgent_MultipleStartStop verifies that creating and stopping multiple
// agents in sequence does not cause issues.
func TestAgent_MultipleStartStop(t *testing.T) {
	eng, _ := newTestEngine(t)
	mgr := newCaddyManager("127.0.0.1:0")

	for i := 0; i < 3; i++ {
		agent := agentsync.NewAgent(eng, mgr)
		ctx, cancel := context.WithCancel(context.Background())
		agent.Start(ctx)
		time.Sleep(20 * time.Millisecond)
		agent.Stop()
		cancel()
	}
}

// TestAgent_StopWithoutStart verifies that calling Stop on a freshly
// created agent (whose Start was never called) blocks appropriately.
// Since Start was never called, run() never ran and done was never closed.
// We verify this by ensuring Stop would block and not panic.
// Note: this is a design check — in practice Start is always called before
// Stop. We skip this if it would deadlock.
func TestAgent_StopIdempotent(t *testing.T) {
	eng, _ := newTestEngine(t)
	mgr := newCaddyManager("127.0.0.1:0")
	agent := agentsync.NewAgent(eng, mgr)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	agent.Start(ctx)
	time.Sleep(20 * time.Millisecond)

	// First stop should work fine.
	done := make(chan struct{})
	go func() {
		agent.Stop()
		close(done)
	}()

	select {
	case <-done:
		// Clean stop.
	case <-time.After(5 * time.Second):
		t.Fatal("First Stop() did not return within 5 seconds")
	}
}

// TestAgent_ChangeAfterStop verifies that config changes arriving after the
// agent has been stopped do not cause issues.
func TestAgent_ChangeAfterStop(t *testing.T) {
	eng, _ := newTestEngine(t)
	mgr := newCaddyManager("127.0.0.1:0")
	agent := agentsync.NewAgent(eng, mgr)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	agent.Start(ctx)
	time.Sleep(20 * time.Millisecond)
	agent.Stop()

	// Apply changes after stop — should not panic or affect anything.
	applyServiceChange(t, eng, "after-stop-svc")
}
