package gateway

import (
	"fmt"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/config"
)

// RegisterStubRoutes registers placeholder handlers for API endpoints that
// the frontend calls but don't have real implementations yet. Each handler
// returns static or config-derived data so the admin panel can render
// without hitting 404s or error boundaries.
//
// Note: GET /api/v1/cluster moved to RegisterClusterRoutes (#83).
// Note: GET /api/v1/plugins and GET /api/v1/plugins/manifest are
// superseded by the tenant-scoped plugin routes in RegisterPluginRoutes.
func RegisterStubRoutes(mux *http.ServeMux, _ *config.Config) {
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
