package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/riokulabs/rioku/internal/config"
)

// RegisterStubRoutes registers placeholder handlers for API endpoints that
// the frontend calls but don't have real implementations yet. Each handler
// returns static or config-derived data so the admin panel can render
// without hitting 404s or error boundaries.
func RegisterStubRoutes(mux *http.ServeMux, cfg *config.Config) {
	mux.HandleFunc("GET /api/v1/cluster", handleStubCluster(cfg))
	mux.HandleFunc("GET /api/v1/plugins", handleStubEmptyArray())
	mux.HandleFunc("GET /api/v1/plugins/manifest", handleStubEmptyArray())
	mux.HandleFunc("GET /api/v1/settings", handleStubSettings(cfg))
}

func handleStubCluster(cfg *config.Config) http.HandlerFunc {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "node-0"
	}

	return func(w http.ResponseWriter, _ *http.Request) {
		resp := map[string]interface{}{
			"nodes": []map[string]interface{}{
				{
					"name":           hostname,
					"role":           "bootstrap",
					"health":         "healthy",
					"daemon_version": "0.1.0-dev",
					"caddy_version":  "2.9.1",
					"store_mode":     cfg.Store.Driver,
					"last_seen":      time.Now().UTC().Format(time.RFC3339),
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleStubEmptyArray() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	}
}

func handleStubSettings(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		resp := map[string]interface{}{
			"daemon_address":         cfg.Listen.REST,
			"data_directory":         cfg.DataDir,
			"store_driver":           cfg.Store.Driver,
			"store_connection":       storeConnection(cfg),
			"pki_algorithm":          cfg.PKI.CA.KeyAlgorithm,
			"pki_rotation_threshold": formatDuration(cfg.PKI.Node.RotationThreshold),
			"pki_cert_status":        "healthy",
			"ai_trace_store":         cfg.Traces.Store,
			"ai_retention_period":    formatDuration(cfg.Traces.Retention.AISessions),
			"log_level":              cfg.LogLevel,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// storeConnection returns a display string for the active store backend.
func storeConnection(cfg *config.Config) string {
	switch cfg.Store.Driver {
	case "sqlite":
		return cfg.Store.SQLite.Path
	case "raft":
		return cfg.Store.Raft.BindAddr
	case "postgres":
		return cfg.Store.Postgres.DSN
	case "mysql":
		if cfg.Store.MySQL.Galera {
			return "galera cluster"
		}
		return cfg.Store.MySQL.DSN
	default:
		return ""
	}
}

// formatDuration renders a time.Duration as a human-readable string like "30 days".
func formatDuration(d time.Duration) string {
	days := int(d.Hours() / 24)
	if days > 0 {
		if days == 1 {
			return "1 day"
		}
		return fmt.Sprintf("%d days", days)
	}
	return d.String()
}
