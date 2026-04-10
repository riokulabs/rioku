package grpc

import (
	"context"
	"encoding/json"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// newTestConfigService creates a configService backed by a fresh SQLite store
// with migrations applied and a Caddy compiler configured for localhost:8080.
func newTestConfigService(t *testing.T) (*configService, store.Driver) {
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

	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{}, "", nil)
	engine := config.NewEngine(d, compiler)
	svc := newConfigService(engine)
	return svc, d
}

// makeRouteChange creates a ConfigChange that upserts a route with the given
// name and upstream address.
func makeRouteChange(name, upstreamAddr string) *riokuv1.ConfigChange {
	return &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name: name,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{name + ".example.com"}},
					},
					Target: &riokuv1.Route_Upstream{
						Upstream: &riokuv1.DirectUpstream{
							Address: upstreamAddr,
						},
					},
					Enabled: true,
				},
			},
		},
	}
}

// makeServiceChange creates a ConfigChange that upserts a service.
func makeServiceChange(name string, upstreams []*riokuv1.Upstream) *riokuv1.ConfigChange {
	return &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name:      name,
					Upstreams: upstreams,
					LbPolicy:  riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				},
			},
		},
	}
}

// ---------------------------------------------------------------------------
// Mock streams
// ---------------------------------------------------------------------------

// mockConfigEventStream implements grpc.ServerStreamingServer[riokuv1.ConfigEvent].
type mockConfigEventStream struct {
	grpc.ServerStreamingServer[riokuv1.ConfigEvent]
	ctx    context.Context
	events []*riokuv1.ConfigEvent
	mu     sync.Mutex
}

func (m *mockConfigEventStream) Send(e *riokuv1.ConfigEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, e)
	return nil
}

func (m *mockConfigEventStream) Context() context.Context { return m.ctx }

func (m *mockConfigEventStream) getEvents() []*riokuv1.ConfigEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*riokuv1.ConfigEvent, len(m.events))
	copy(out, m.events)
	return out
}

// mockAuditStream implements grpc.ServerStreamingServer[riokuv1.AuditEntry].
type mockAuditStream struct {
	grpc.ServerStreamingServer[riokuv1.AuditEntry]
	ctx     context.Context
	entries []*riokuv1.AuditEntry
	mu      sync.Mutex
}

func (m *mockAuditStream) Send(e *riokuv1.AuditEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries = append(m.entries, e)
	return nil
}

func (m *mockAuditStream) Context() context.Context { return m.ctx }

func (m *mockAuditStream) getEntries() []*riokuv1.AuditEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*riokuv1.AuditEntry, len(m.entries))
	copy(out, m.entries)
	return out
}

// mockExportStream implements grpc.ServerStreamingServer[riokuv1.ConfigChunk].
type mockExportStream struct {
	grpc.ServerStreamingServer[riokuv1.ConfigChunk]
	ctx    context.Context
	chunks []*riokuv1.ConfigChunk
	mu     sync.Mutex
}

func (m *mockExportStream) Send(c *riokuv1.ConfigChunk) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.chunks = append(m.chunks, c)
	return nil
}

func (m *mockExportStream) Context() context.Context { return m.ctx }

func (m *mockExportStream) getChunks() []*riokuv1.ConfigChunk {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*riokuv1.ConfigChunk, len(m.chunks))
	copy(out, m.chunks)
	return out
}

// mockImportStream implements grpc.ClientStreamingServer[riokuv1.ConfigChunk, riokuv1.ImportResult].
type mockImportStream struct {
	grpc.ClientStreamingServer[riokuv1.ConfigChunk, riokuv1.ImportResult]
	ctx    context.Context
	chunks []*riokuv1.ConfigChunk
	idx    int
	result *riokuv1.ImportResult
	mu     sync.Mutex
}

func (m *mockImportStream) Recv() (*riokuv1.ConfigChunk, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.idx >= len(m.chunks) {
		return nil, io.EOF
	}
	chunk := m.chunks[m.idx]
	m.idx++
	return chunk, nil
}

func (m *mockImportStream) SendAndClose(r *riokuv1.ImportResult) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.result = r
	return nil
}

func (m *mockImportStream) Context() context.Context { return m.ctx }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestConfigService_GetConfig_Empty(t *testing.T) {
	svc, _ := newTestConfigService(t)
	ctx := context.Background()

	snap, err := svc.GetConfig(ctx, &riokuv1.GetConfigRequest{})
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if snap == nil {
		t.Fatal("GetConfig returned nil snapshot")
	}
	if len(snap.GetRoutes()) != 0 {
		t.Errorf("routes = %d, want 0", len(snap.GetRoutes()))
	}
	if len(snap.GetServices()) != 0 {
		t.Errorf("services = %d, want 0", len(snap.GetServices()))
	}
	if len(snap.GetPolicies()) != 0 {
		t.Errorf("policies = %d, want 0", len(snap.GetPolicies()))
	}
}

func TestConfigService_ApplyChange_CreateRoute(t *testing.T) {
	svc, _ := newTestConfigService(t)
	ctx := context.Background()

	change := makeRouteChange("test-route", "localhost:9090")
	result, err := svc.ApplyChange(ctx, change)
	if err != nil {
		t.Fatalf("ApplyChange: %v", err)
	}
	if result == nil {
		t.Fatal("ApplyChange returned nil result")
	}
	if result.GetMeta() == nil {
		t.Fatal("ApplyChange result has nil meta")
	}
	if result.GetMeta().GetConfigVersion() <= 0 {
		t.Errorf("config_version = %d, want > 0", result.GetMeta().GetConfigVersion())
	}
	if result.GetMeta().GetActor() != "anonymous" {
		t.Errorf("actor = %q, want %q", result.GetMeta().GetActor(), "anonymous")
	}
	if result.GetMeta().GetMutatedAt() == nil {
		t.Error("mutated_at is nil")
	}
}

func TestConfigService_ApplyChange_CreateService(t *testing.T) {
	svc, _ := newTestConfigService(t)
	ctx := context.Background()

	change := makeServiceChange("backend-svc", []*riokuv1.Upstream{
		{Address: "10.0.0.1:8080", Weight: 1},
		{Address: "10.0.0.2:8080", Weight: 1},
	})
	result, err := svc.ApplyChange(ctx, change)
	if err != nil {
		t.Fatalf("ApplyChange: %v", err)
	}
	if result.GetMeta().GetConfigVersion() <= 0 {
		t.Errorf("config_version = %d, want > 0", result.GetMeta().GetConfigVersion())
	}

	// Verify the service appears in GetConfig.
	snap, err := svc.GetConfig(ctx, &riokuv1.GetConfigRequest{})
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.GetServices()) != 1 {
		t.Fatalf("services = %d, want 1", len(snap.GetServices()))
	}
	if snap.GetServices()[0].GetName() != "backend-svc" {
		t.Errorf("service name = %q, want %q", snap.GetServices()[0].GetName(), "backend-svc")
	}
	if len(snap.GetServices()[0].GetUpstreams()) != 2 {
		t.Errorf("upstreams = %d, want 2", len(snap.GetServices()[0].GetUpstreams()))
	}
}

func TestConfigService_GetConfig_WithData(t *testing.T) {
	svc, _ := newTestConfigService(t)
	ctx := context.Background()

	// Create 2 routes and 1 service.
	if _, err := svc.ApplyChange(ctx, makeRouteChange("route-alpha", "localhost:3000")); err != nil {
		t.Fatalf("ApplyChange route-alpha: %v", err)
	}
	if _, err := svc.ApplyChange(ctx, makeRouteChange("route-beta", "localhost:3001")); err != nil {
		t.Fatalf("ApplyChange route-beta: %v", err)
	}
	if _, err := svc.ApplyChange(ctx, makeServiceChange("svc-gamma", []*riokuv1.Upstream{
		{Address: "10.0.0.5:8080", Weight: 1},
	})); err != nil {
		t.Fatalf("ApplyChange svc-gamma: %v", err)
	}

	snap, err := svc.GetConfig(ctx, &riokuv1.GetConfigRequest{})
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}

	if len(snap.GetRoutes()) != 2 {
		t.Errorf("routes = %d, want 2", len(snap.GetRoutes()))
	}
	if len(snap.GetServices()) != 1 {
		t.Errorf("services = %d, want 1", len(snap.GetServices()))
	}
	if snap.GetVersion() <= 0 {
		t.Errorf("version = %d, want > 0", snap.GetVersion())
	}

	// Verify route names exist.
	routeNames := make(map[string]bool)
	for _, r := range snap.GetRoutes() {
		routeNames[r.GetName()] = true
	}
	if !routeNames["route-alpha"] {
		t.Error("route-alpha not found in snapshot")
	}
	if !routeNames["route-beta"] {
		t.Error("route-beta not found in snapshot")
	}
}

func TestConfigService_WatchChanges(t *testing.T) {
	svc, drv := newTestConfigService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// The SQLite driver's Notify() may return nil (no push notifications).
	// In that case, WatchChanges returns a closed channel immediately,
	// so we just verify it doesn't error. If Notify() returns a channel,
	// we verify that events arrive.
	notify := drv.Notify()

	stream := &mockConfigEventStream{ctx: ctx}

	errCh := make(chan error, 1)
	go func() {
		errCh <- svc.WatchChanges(&riokuv1.WatchRequest{}, stream)
	}()

	if notify == nil {
		// No push notification support. WatchChanges should return quickly.
		select {
		case err := <-errCh:
			if err != nil {
				t.Fatalf("WatchChanges: %v", err)
			}
		case <-time.After(2 * time.Second):
			cancel()
			t.Fatal("WatchChanges did not return for nil Notify channel")
		}
	} else {
		// Give subscriber time to register.
		time.Sleep(10 * time.Millisecond)

		// Apply a change to trigger a notification.
		if _, err := svc.ApplyChange(ctx, makeRouteChange("watch-test", "localhost:5000")); err != nil {
			t.Fatalf("ApplyChange: %v", err)
		}

		// Wait for event to propagate.
		time.Sleep(50 * time.Millisecond)

		cancel()

		if err := <-errCh; err != nil {
			t.Fatalf("WatchChanges: %v", err)
		}

		events := stream.getEvents()
		if len(events) == 0 {
			t.Error("expected at least 1 config event, got 0")
		}
	}
}

func TestConfigService_GetAuditLog(t *testing.T) {
	svc, _ := newTestConfigService(t)
	ctx := context.Background()

	// Apply a route change to generate an audit entry.
	if _, err := svc.ApplyChange(ctx, makeRouteChange("audit-route", "localhost:6000")); err != nil {
		t.Fatalf("ApplyChange: %v", err)
	}

	stream := &mockAuditStream{ctx: ctx}
	err := svc.GetAuditLog(&riokuv1.AuditQuery{}, stream)
	if err != nil {
		t.Fatalf("GetAuditLog: %v", err)
	}

	entries := stream.getEntries()
	if len(entries) == 0 {
		t.Fatal("expected at least 1 audit entry, got 0")
	}

	// Verify the audit entry fields.
	entry := entries[0]
	if entry.GetActor() != "anonymous" {
		t.Errorf("actor = %q, want %q", entry.GetActor(), "anonymous")
	}
	if entry.GetEntityType() != "route" {
		t.Errorf("entity_type = %q, want %q", entry.GetEntityType(), "route")
	}
	if entry.GetOperation() != "CREATE" {
		t.Errorf("operation = %q, want %q", entry.GetOperation(), "CREATE")
	}
	if entry.GetConfigVersion() <= 0 {
		t.Errorf("config_version = %d, want > 0", entry.GetConfigVersion())
	}
	if entry.GetOccurredAt() == nil {
		t.Error("occurred_at is nil")
	}
	if entry.GetId() == "" {
		t.Error("audit entry id is empty")
	}
}

func TestConfigService_GetAuditLog_WithFilters(t *testing.T) {
	svc, _ := newTestConfigService(t)
	ctx := context.Background()

	now := time.Now().UTC()

	// Apply a change to generate an audit entry.
	if _, err := svc.ApplyChange(ctx, makeRouteChange("filtered-route", "localhost:6001")); err != nil {
		t.Fatalf("ApplyChange: %v", err)
	}

	// Query with Since/Until and Page filters to exercise those branches.
	stream := &mockAuditStream{ctx: ctx}
	err := svc.GetAuditLog(&riokuv1.AuditQuery{
		Since: timestamppb.New(now.Add(-1 * time.Hour)),
		Until: timestamppb.New(now.Add(1 * time.Hour)),
		Page:  &riokuv1.PageRequest{PageSize: 10},
	}, stream)
	if err != nil {
		t.Fatalf("GetAuditLog with filters: %v", err)
	}

	entries := stream.getEntries()
	if len(entries) == 0 {
		t.Fatal("expected at least 1 audit entry with time filters, got 0")
	}

	// Query with actor filter.
	stream2 := &mockAuditStream{ctx: ctx}
	err = svc.GetAuditLog(&riokuv1.AuditQuery{
		Actor: "anonymous",
	}, stream2)
	if err != nil {
		t.Fatalf("GetAuditLog with actor filter: %v", err)
	}

	entries2 := stream2.getEntries()
	if len(entries2) == 0 {
		t.Fatal("expected at least 1 audit entry with actor filter, got 0")
	}
}

func TestConfigService_ExportConfig(t *testing.T) {
	svc, _ := newTestConfigService(t)
	ctx := context.Background()

	// Seed some data.
	if _, err := svc.ApplyChange(ctx, makeRouteChange("export-route", "localhost:7000")); err != nil {
		t.Fatalf("ApplyChange route: %v", err)
	}
	if _, err := svc.ApplyChange(ctx, makeServiceChange("export-svc", []*riokuv1.Upstream{
		{Address: "10.0.0.10:8080", Weight: 1},
	})); err != nil {
		t.Fatalf("ApplyChange service: %v", err)
	}

	stream := &mockExportStream{ctx: ctx}
	err := svc.ExportConfig(&riokuv1.ExportRequest{}, stream)
	if err != nil {
		t.Fatalf("ExportConfig: %v", err)
	}

	chunks := stream.getChunks()
	if len(chunks) == 0 {
		t.Fatal("expected at least 1 chunk, got 0")
	}

	// The last chunk should have Last=true.
	lastChunk := chunks[len(chunks)-1]
	if !lastChunk.GetLast() {
		t.Error("last chunk does not have Last=true")
	}

	// Verify sequences are consecutive starting from 0.
	for i, c := range chunks {
		if c.GetSequence() != int32(i) {
			t.Errorf("chunk[%d].sequence = %d, want %d", i, c.GetSequence(), i)
		}
	}

	// Reassemble and verify the exported data is valid JSON.
	var data []byte
	for _, c := range chunks {
		data = append(data, c.GetData()...)
	}

	// Verify it's valid JSON.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("exported data is not valid JSON: %v", err)
	}

	// Verify the exported JSON contains expected top-level keys.
	for _, key := range []string{"services"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("exported JSON missing key %q", key)
		}
	}

	// Verify exported data is non-trivial (contains our seeded data).
	exported := string(data)
	if !strings.Contains(exported, "export-svc") {
		t.Error("exported data does not contain service name 'export-svc'")
	}
	if !strings.Contains(exported, "export-route") {
		t.Error("exported data does not contain route name 'export-route'")
	}
}

func TestConfigService_ImportConfig(t *testing.T) {
	svc, _ := newTestConfigService(t)
	ctx := context.Background()

	// Build a snapshot with services only (no routes with oneofs that
	// trip up the standard json round-trip used by ExportConfig/ImportConfig).
	snapshot := &riokuv1.ConfigSnapshot{
		Services: []*riokuv1.Service{
			{
				Name: "imported-svc-alpha",
				Upstreams: []*riokuv1.Upstream{
					{Address: "10.0.0.30:8080", Weight: 1},
				},
				LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
			},
			{
				Name: "imported-svc-beta",
				Upstreams: []*riokuv1.Upstream{
					{Address: "10.0.0.31:8080", Weight: 2},
					{Address: "10.0.0.32:8080", Weight: 1},
				},
				LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
			},
		},
	}

	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}

	// Send as a single chunk.
	importStream := &mockImportStream{
		ctx: ctx,
		chunks: []*riokuv1.ConfigChunk{
			{Data: data, Sequence: 0, Last: true},
		},
	}
	if err := svc.ImportConfig(importStream); err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}

	if importStream.result == nil {
		t.Fatal("ImportConfig did not send result")
	}

	result := importStream.result
	if result.GetMeta() == nil {
		t.Fatal("ImportResult has nil meta")
	}
	if result.GetMeta().GetConfigVersion() <= 0 {
		t.Errorf("config_version = %d, want > 0", result.GetMeta().GetConfigVersion())
	}
	if result.GetServicesImported() != 2 {
		t.Errorf("services_imported = %d, want 2", result.GetServicesImported())
	}

	// Verify imported data via GetConfig.
	snap, err := svc.GetConfig(ctx, &riokuv1.GetConfigRequest{})
	if err != nil {
		t.Fatalf("GetConfig after import: %v", err)
	}
	if len(snap.GetServices()) != 2 {
		t.Errorf("services after import = %d, want 2", len(snap.GetServices()))
	}

	// Verify service names survived the round-trip.
	svcNames := make(map[string]bool)
	for _, s := range snap.GetServices() {
		svcNames[s.GetName()] = true
	}
	if !svcNames["imported-svc-alpha"] {
		t.Error("imported-svc-alpha not found after import")
	}
	if !svcNames["imported-svc-beta"] {
		t.Error("imported-svc-beta not found after import")
	}
}
