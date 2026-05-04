package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/cluster"
)

// authedRequest builds an httptest request with a SessionClaims that
// satisfies the cluster:* permissions used by the cluster routes. Tests
// in this file exercise handlers in isolation (no AuthMiddleware), so we
// inject the claims directly into the context.
func authedRequest(method, target string, body any) *http.Request {
	req := httptest.NewRequest(method, target, nil)
	_ = body
	claims := &auth.SessionClaims{
		SessionID: "test-session",
		UserID:    "test-user",
		Username:  "tester",
		Roles:     []string{"superadmin"},
		Scopes:    []string{"*"},
	}
	return req.WithContext(auth.WithSessionClaims(req.Context(), claims))
}

// fakeClusterService is a hand-rolled cluster.Service used only in tests.
// We don't use cluster.NewLocalOnlyService here because we want to verify
// the gateway's contract independent of LocalOnlyService's internals
// (LocalOnlyService has its own coverage in the cluster package).
type fakeClusterService struct {
	nodes      []cluster.NodeInfo
	removeErr  error
	removed    atomic.Value // string — last id passed to RemoveNode
	syncResult cluster.SyncResult
	syncErr    error
	syncCalls  atomic.Int64
}

func (f *fakeClusterService) ListNodes(_ context.Context) ([]cluster.NodeInfo, error) {
	return f.nodes, nil
}

func (f *fakeClusterService) RemoveNode(_ context.Context, id string) error {
	f.removed.Store(id)
	return f.removeErr
}

func (f *fakeClusterService) ForceSync(_ context.Context) (cluster.SyncResult, error) {
	f.syncCalls.Add(1)
	return f.syncResult, f.syncErr
}

// newTestClusterService returns a fakeClusterService preloaded with two
// nodes — used by TestStubCluster_LegacyRouteServedByClusterRoutes too.
func newTestClusterService(t *testing.T) *fakeClusterService {
	t.Helper()
	return &fakeClusterService{
		nodes: []cluster.NodeInfo{
			{
				ID:            "node-self",
				Name:          "node-self",
				Role:          cluster.RoleBootstrap,
				Health:        cluster.HealthHealthy,
				DaemonVersion: "0.2.0",
				StoreMode:     "sqlite",
				IsSelf:        true,
				IsLeader:      true,
				LastSeen:      time.Now().UTC(),
			},
			{
				ID:            "node-peer",
				Name:          "node-peer",
				Role:          cluster.RoleVoter,
				Health:        cluster.HealthHealthy,
				DaemonVersion: "0.2.0",
				StoreMode:     "sqlite",
				IsSelf:        false,
				IsLeader:      false,
				LastSeen:      time.Now().UTC(),
			},
		},
		syncResult: cluster.SyncResult{
			StartedAt:     time.Now().UTC(),
			Duration:      5 * time.Millisecond,
			PushedToCaddy: true,
			NodesNotified: 1,
		},
	}
}

func TestClusterRoutes_ListNodes(t *testing.T) {
	svc := newTestClusterService(t)
	mux := http.NewServeMux()
	RegisterClusterRoutes(mux, svc)

	req := authedRequest(http.MethodGet, "/api/v1/cluster/nodes", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		Items []cluster.NodeInfo `json:"items"`
		Total int                `json:"total"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Total != 2 || len(body.Items) != 2 {
		t.Errorf("expected 2 nodes, got total=%d len=%d", body.Total, len(body.Items))
	}
	if body.Items[0].ID != "node-self" {
		t.Errorf("expected first node node-self, got %q", body.Items[0].ID)
	}
}

func TestClusterRoutes_RemoveNodeSuccess(t *testing.T) {
	svc := newTestClusterService(t)
	mux := http.NewServeMux()
	RegisterClusterRoutes(mux, svc)

	req := authedRequest(http.MethodPost, "/api/v1/cluster/nodes/node-peer/remove", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	if got, _ := svc.removed.Load().(string); got != "node-peer" {
		t.Errorf("RemoveNode called with %q, want node-peer", got)
	}
}

func TestClusterRoutes_RemoveNodeError(t *testing.T) {
	svc := newTestClusterService(t)
	svc.removeErr = errors.New("cluster: cannot remove node \"node-self\" from a single-node deployment")
	mux := http.NewServeMux()
	RegisterClusterRoutes(mux, svc)

	req := authedRequest(http.MethodPost, "/api/v1/cluster/nodes/node-self/remove", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestClusterRoutes_ForceSync(t *testing.T) {
	svc := newTestClusterService(t)
	mux := http.NewServeMux()
	RegisterClusterRoutes(mux, svc)

	req := authedRequest(http.MethodPost, "/api/v1/cluster/sync", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if svc.syncCalls.Load() != 1 {
		t.Errorf("expected 1 sync call, got %d", svc.syncCalls.Load())
	}
	var body cluster.SyncResult
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.PushedToCaddy {
		t.Error("expected PushedToCaddy=true in body")
	}
}

func TestClusterRoutes_ForceSyncFailure(t *testing.T) {
	svc := newTestClusterService(t)
	svc.syncErr = errors.New("caddy admin API unreachable")
	mux := http.NewServeMux()
	RegisterClusterRoutes(mux, svc)

	req := authedRequest(http.MethodPost, "/api/v1/cluster/sync", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", rec.Code)
	}
}

func TestClusterRoutes_NilServiceSkipsRegistration(t *testing.T) {
	mux := http.NewServeMux()
	RegisterClusterRoutes(mux, nil)

	// No routes should be registered — request should 404.
	req := authedRequest(http.MethodGet, "/api/v1/cluster/nodes", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404 with nil svc, got %d", rec.Code)
	}
}

// LocalOnlyService coverage — exercise it through the HTTP layer too so
// the whole stack is verified.
func TestClusterRoutes_LocalOnlyServiceIntegration(t *testing.T) {
	called := atomic.Bool{}
	svc := cluster.NewLocalOnlyService(cluster.LocalOnlyConfig{
		NodeID:        "the-node",
		NodeName:      "the-node",
		DaemonVersion: "test-v",
		StoreMode:     "sqlite",
		CaddyReload: func(_ context.Context) error {
			called.Store(true)
			return nil
		},
	})
	mux := http.NewServeMux()
	RegisterClusterRoutes(mux, svc)

	// List
	req := authedRequest(http.MethodGet, "/api/v1/cluster/nodes", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d", rec.Code)
	}
	var listBody struct {
		Total int `json:"total"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&listBody)
	if listBody.Total != 1 {
		t.Errorf("expected 1 node from LocalOnlyService, got %d", listBody.Total)
	}

	// Remove → must error (single-node).
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, authedRequest(http.MethodPost, "/api/v1/cluster/nodes/the-node/remove", nil))
	if rec2.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for single-node remove, got %d", rec2.Code)
	}

	// Sync → fires the CaddyReload hook.
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, authedRequest(http.MethodPost, "/api/v1/cluster/sync", nil))
	if rec3.Code != http.StatusOK {
		t.Errorf("expected 200 for sync, got %d", rec3.Code)
	}
	if !called.Load() {
		t.Error("expected CaddyReload hook to be called")
	}
}
