package gateway

import (
	"encoding/json"
	"net/http"
	"runtime"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/version"
)

// RegisterSettingsRoutes registers category-specific settings GET endpoints.
// All endpoints require the "settings:read" permission.
func RegisterSettingsRoutes(mux *http.ServeMux, cfg *config.Config, st store.Driver, startedAt time.Time) {
	mux.Handle("GET /api/v1/settings/general", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsGeneral(cfg, startedAt))))
	mux.Handle("GET /api/v1/settings/network", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsNetwork(cfg))))
	mux.Handle("GET /api/v1/settings/store", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsStore(cfg, st))))
	mux.Handle("GET /api/v1/settings/auth", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsAuth(cfg))))
	mux.Handle("GET /api/v1/settings/traces", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsTraces(cfg))))
	mux.Handle("GET /api/v1/settings/pki", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsPKI(cfg))))
	mux.Handle("GET /api/v1/settings/caddy", RequirePermission("settings:read")(http.HandlerFunc(handleSettingsCaddy(cfg))))
}

func handleSettingsGeneral(cfg *config.Config, startedAt time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"logLevel":      cfg.LogLevel,
			"dataDir":       cfg.DataDir,
			"daemonVersion": version.Version,
			"goVersion":     runtime.Version(),
			"uptimeSeconds": int(time.Since(startedAt).Seconds()),
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsNetwork(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"grpcAddress": cfg.Listen.GRPC,
			"restAddress": cfg.Listen.REST,
			"adminDomain": cfg.Listen.AdminDomain,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsStore(cfg *config.Config, st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		health := st.Health(ctx)
		migVer, err := st.CurrentVersion(ctx)
		if err != nil {
			writeInternalError(w, r, "store current version")
			return
		}

		resp := map[string]interface{}{
			"driver":           cfg.Store.Driver,
			"connection":       storeConnection(cfg),
			"healthy":          health.OK,
			"migrationVersion": migVer,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsAuth(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"passwordPolicy": map[string]interface{}{
				"minLength":        cfg.Auth.PasswordPolicy.MinLength,
				"requireUppercase": cfg.Auth.PasswordPolicy.RequireUppercase,
				"requireLowercase": cfg.Auth.PasswordPolicy.RequireLowercase,
				"requireDigit":     cfg.Auth.PasswordPolicy.RequireDigit,
				"requireSpecial":   cfg.Auth.PasswordPolicy.RequireSpecial,
				"maxAgeDays":       cfg.Auth.PasswordPolicy.MaxAgeDays,
			},
			"lockout": map[string]interface{}{
				"maxAttempts":            cfg.Auth.Lockout.MaxAttempts,
				"lockoutDurationMinutes": int(cfg.Auth.Lockout.LockoutDuration.Minutes()),
				"resetAfterMinutes":      int(cfg.Auth.Lockout.ResetAfter.Minutes()),
			},
			"rateLimit": map[string]interface{}{
				"requestsPerMinute": cfg.Auth.RateLimit.RequestsPerMinute,
				"burstSize":         cfg.Auth.RateLimit.BurstSize,
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsTraces(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"store": cfg.Traces.Store,
			"retention": map[string]interface{}{
				"requestTraces": cfg.Traces.Retention.RequestTraces.String(),
				"aiSessions":    cfg.Traces.Retention.AISessions.String(),
				"aggregates":    cfg.Traces.Retention.Aggregates.String(),
			},
		}
		if cfg.Traces.Sampling.Rate != nil {
			resp["samplingRate"] = *cfg.Traces.Sampling.Rate
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsPKI(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"keyAlgorithm":      cfg.PKI.CA.KeyAlgorithm,
			"passphraseSource":  cfg.PKI.CA.KeyPassphraseSource,
			"caValidity":        cfg.PKI.CA.Validity.String(),
			"nodeValidity":      cfg.PKI.Node.Validity.String(),
			"rotationThreshold": cfg.PKI.Node.RotationThreshold.String(),
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func handleSettingsCaddy(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"binary":       cfg.Caddy.Binary,
			"adminAddr":    cfg.Caddy.AdminAddr,
			"trafficAddrs": cfg.Caddy.TrafficAddrs,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
