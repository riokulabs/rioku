package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/config"
)

// TestStubCluster_LegacyRouteServedByClusterRoutes verifies that the
// legacy GET /api/v1/cluster shape (used by the current admin panel) is
// preserved by the new RegisterClusterRoutes registration.
func TestStubCluster_LegacyRouteServedByClusterRoutes(t *testing.T) {
	mux := http.NewServeMux()
	svc := newTestClusterService(t)
	RegisterClusterRoutes(mux, svc)

	req := authedRequest(http.MethodGet, "/api/v1/cluster", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	nodes, ok := body["nodes"].([]any)
	if !ok || len(nodes) == 0 {
		t.Fatal("expected at least one node in legacy cluster response")
	}
	node := nodes[0].(map[string]any)

	if node["health"] != "healthy" {
		t.Errorf("health = %q, want healthy", node["health"])
	}
	if node["role"] != "bootstrap" {
		t.Errorf("role = %q, want bootstrap", node["role"])
	}
}

// TestStubPluginsRemoved verifies that the Plan 0c global plugin stubs
// (GET /api/v1/plugins and GET /api/v1/plugins/manifest) have been retired.
// Plan 9 replaces them with tenant-scoped routes in RegisterPluginRoutes.
func TestStubPluginsRemoved(t *testing.T) {
	cfg := config.Default()
	mux := http.NewServeMux()
	RegisterStubRoutes(mux, cfg)

	// These global stub paths are gone — they now 404 on stub-only mux.
	// Real requests go to /api/v1/t/{tenant}/plugins via RegisterPluginRoutes.
	for _, path := range []string{"/api/v1/plugins", "/api/v1/plugins/manifest"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusNotFound {
				t.Fatalf("expected 404 (stub retired), got %d", rec.Code)
			}
		})
	}
}

func TestStoreConnection(t *testing.T) {
	tests := []struct {
		name     string
		mutate   func(*config.Config)
		expected string
	}{
		{
			name:     "sqlite",
			mutate:   func(c *config.Config) { c.Store.Driver = "sqlite"; c.Store.SQLite.Path = "/data/rioku.db" },
			expected: "/data/rioku.db",
		},
		{
			name: "postgres",
			mutate: func(c *config.Config) {
				c.Store.Driver = "postgres"
				c.Store.Postgres.DSN = "postgres://localhost/rioku"
			},
			expected: "postgres://localhost/rioku",
		},
		{
			name:     "mysql",
			mutate:   func(c *config.Config) { c.Store.Driver = "mysql"; c.Store.MySQL.DSN = "root@tcp(localhost)/rioku" },
			expected: "root@tcp(localhost)/rioku",
		},
		{
			name:     "mysql_galera",
			mutate:   func(c *config.Config) { c.Store.Driver = "mysql"; c.Store.MySQL.Galera = true },
			expected: "galera cluster",
		},
		{
			name:     "raft",
			mutate:   func(c *config.Config) { c.Store.Driver = "raft"; c.Store.Raft.BindAddr = "0.0.0.0:9001" },
			expected: "0.0.0.0:9001",
		},
		{
			name:     "unknown",
			mutate:   func(c *config.Config) { c.Store.Driver = "unknown" },
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := config.Default()
			tt.mutate(cfg)
			if got := storeConnection(cfg); got != tt.expected {
				t.Errorf("storeConnection() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		d    time.Duration
		want string
	}{
		{30 * 24 * time.Hour, "30 days"},
		{1 * 24 * time.Hour, "1 day"},
		{12 * time.Hour, "12h0m0s"},
		{90 * time.Minute, "1h30m0s"},
		{0, "0s"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := formatDuration(tt.d); got != tt.want {
				t.Errorf("formatDuration(%v) = %q, want %q", tt.d, got, tt.want)
			}
		})
	}
}
