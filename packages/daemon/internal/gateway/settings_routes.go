package gateway

import (
	"encoding/json"
	"net/http"
	"runtime"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/version"
)

// RegisterSettingsRoutes registers category-specific settings GET + PATCH
// endpoints. GETs require `settings:read`, PATCHes require `settings:write`.
//
// `runtime` may be nil for backwards-compatibility callers that haven't
// adopted the runtime-settings wrapper yet — in that case PATCH endpoints
// are not registered and only the GETs are exposed.
func RegisterSettingsRoutes(mux *http.ServeMux, cfg *config.Config, st store.Driver, startedAt time.Time, rs *RuntimeSettings) {
	mux.Handle("GET /api/v1/settings/general", RequirePermission("settings:read")(rerr.H(handleSettingsGeneral(cfg, startedAt))))
	mux.Handle("GET /api/v1/settings/network", RequirePermission("settings:read")(rerr.H(handleSettingsNetwork(cfg))))
	mux.Handle("GET /api/v1/settings/store", RequirePermission("settings:read")(rerr.H(handleSettingsStore(cfg, st))))
	mux.Handle("GET /api/v1/settings/auth", RequirePermission("settings:read")(rerr.H(handleSettingsAuth(cfg))))
	mux.Handle("GET /api/v1/settings/traces", RequirePermission("settings:read")(rerr.H(handleSettingsTraces(cfg))))
	mux.Handle("GET /api/v1/settings/pki", RequirePermission("settings:read")(rerr.H(handleSettingsPKI(cfg))))
	mux.Handle("GET /api/v1/settings/caddy", RequirePermission("settings:read")(rerr.H(handleSettingsCaddy(cfg))))

	if rs != nil {
		mux.Handle("PATCH /api/v1/settings/general", RequirePermission("settings:write")(rerr.H(handlePatchGeneral(rs))))
		mux.Handle("PATCH /api/v1/settings/auth", RequirePermission("settings:write")(rerr.H(handlePatchAuth(rs))))
		mux.Handle("PATCH /api/v1/settings/traces", RequirePermission("settings:write")(rerr.H(handlePatchTraces(rs))))
	}
}

func handleSettingsGeneral(cfg *config.Config, startedAt time.Time) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		resp := map[string]interface{}{
			"logLevel":      cfg.LogLevel,
			"dataDir":       cfg.DataDir,
			"daemonVersion": version.Version,
			"goVersion":     runtime.Version(),
			"uptimeSeconds": int(time.Since(startedAt).Seconds()),
		}
		return rerr.JSON(w, resp)
	}
}

func handleSettingsNetwork(cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		resp := map[string]interface{}{
			"grpcAddress": cfg.Listen.GRPC,
			"restAddress": cfg.Listen.REST,
			"adminDomain": cfg.Listen.AdminDomain,
		}
		return rerr.JSON(w, resp)
	}
}

func handleSettingsStore(cfg *config.Config, st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		health := st.Health(ctx)
		migVer, err := st.CurrentVersion(ctx)
		if err != nil {
			return rerr.Wrap(err, "store current version")
		}

		resp := map[string]interface{}{
			"driver":           cfg.Store.Driver,
			"connection":       storeConnection(cfg),
			"healthy":          health.OK,
			"migrationVersion": migVer,
		}
		return rerr.JSON(w, resp)
	}
}

func handleSettingsAuth(cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
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
		return rerr.JSON(w, resp)
	}
}

func handleSettingsTraces(cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
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
		return rerr.JSON(w, resp)
	}
}

func handleSettingsPKI(cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		resp := map[string]interface{}{
			"keyAlgorithm":      cfg.PKI.CA.KeyAlgorithm,
			"passphraseSource":  cfg.PKI.CA.KeyPassphraseSource,
			"caValidity":        cfg.PKI.CA.Validity.String(),
			"nodeValidity":      cfg.PKI.Node.Validity.String(),
			"rotationThreshold": cfg.PKI.Node.RotationThreshold.String(),
		}
		return rerr.JSON(w, resp)
	}
}

func handleSettingsCaddy(cfg *config.Config) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		resp := map[string]interface{}{
			"binary":       cfg.Caddy.Binary,
			"adminAddr":    cfg.Caddy.AdminAddr,
			"trafficAddrs": cfg.Caddy.TrafficAddrs,
		}
		return rerr.JSON(w, resp)
	}
}

// ─── PATCH handlers ─────────────────────────────────────────────────────────
//
// PATCH targets a curated subset of fields that downstream code reads on
// every request — log level (LevelVar.Set is atomic), auth
// password/lockout/rate-limit policies, and trace sampling rate.
//
// Restart-bound fields (listen addresses, store driver, Caddy binary path)
// are intentionally NOT exposed for PATCH — admin must edit rioku.yaml and
// restart. Mutations also do NOT persist back to rioku.yaml; the next
// daemon restart reverts to the file's values.

// generalPatch is the partial-update payload for PATCH /settings/general.
type generalPatch struct {
	LogLevel *string `json:"logLevel,omitempty"`
}

func handlePatchGeneral(rs *RuntimeSettings) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var p generalPatch
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if p.LogLevel != nil {
			if err := rs.SetLogLevel(*p.LogLevel); err != nil {
				return rerr.Validation(map[string]string{"logLevel": err.Error()})
			}
		}
		return rerr.JSON(w, map[string]any{"logLevel": rs.GetLogLevel()})
	}
}

// authPatch combines partial updates for password, lockout, and rate-limit
// policies — matches the GET /settings/auth response shape.
type authPatch struct {
	PasswordPolicy *PasswordPolicyPatch `json:"passwordPolicy,omitempty"`
	Lockout        *LockoutPatch        `json:"lockout,omitempty"`
	RateLimit      *RateLimitPatch      `json:"rateLimit,omitempty"`
}

func handlePatchAuth(rs *RuntimeSettings) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var p authPatch
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if p.PasswordPolicy != nil {
			if err := rs.ApplyPasswordPolicyPatch(*p.PasswordPolicy); err != nil {
				return rerr.Validation(map[string]string{"passwordPolicy": err.Error()})
			}
		}
		if p.Lockout != nil {
			if err := rs.ApplyLockoutPatch(*p.Lockout); err != nil {
				return rerr.Validation(map[string]string{"lockout": err.Error()})
			}
		}
		if p.RateLimit != nil {
			if err := rs.ApplyRateLimitPatch(*p.RateLimit); err != nil {
				return rerr.Validation(map[string]string{"rateLimit": err.Error()})
			}
		}
		// Echo the updated auth block.
		return handleSettingsAuth(rs.Config())(w, r)
	}
}

// tracesPatch is the partial-update payload for PATCH /settings/traces.
type tracesPatch struct {
	SamplingRate *float64 `json:"samplingRate,omitempty"`
}

func handlePatchTraces(rs *RuntimeSettings) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var p tracesPatch
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if p.SamplingRate != nil {
			if err := rs.ApplyTracesSamplingPatch(TracesSamplingPatch{Rate: p.SamplingRate}); err != nil {
				return rerr.Validation(map[string]string{"samplingRate": err.Error()})
			}
		}
		// Echo the updated traces block.
		return handleSettingsTraces(rs.Config())(w, r)
	}
}

// writeJSON is a tiny helper to write a JSON response with a status code.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
