// Package gateway: Settings config singleton REST endpoints.
//
// Each is a GET (returns defaults if absent) + PUT (upsert) pair.
//
//	/api/v1/t/{tenant}/settings/network         NetworkConfig
//	/api/v1/t/{tenant}/settings/auth-policy     TenantAuthPolicy
//	/api/v1/t/{tenant}/settings/observability   ObservabilityConfig
//	/api/v1/t/{tenant}/settings/observability/metrics
//	/api/v1/t/{tenant}/settings/observability/logs
//	/api/v1/t/{tenant}/settings/observability/traces
//	/api/v1/t/{tenant}/settings/audit/retention AuditRetentionConfig
package gateway

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/riokulabs/rioku/internal/store"
)

func RegisterSettingsConfigRoutes(mux *http.ServeMux, st store.Driver) {
	// Network
	mux.Handle("GET /api/v1/t/{tenant}/settings/network",
		RequirePermission("network:read")(http.HandlerFunc(handleGetNetworkConfig(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/network",
		RequirePermission("network:write")(http.HandlerFunc(handleUpsertNetworkConfig(st))))

	// Auth policy
	mux.Handle("GET /api/v1/t/{tenant}/settings/auth-policy",
		RequirePermission("tenant-auth:read")(http.HandlerFunc(handleGetAuthPolicy(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/auth-policy",
		RequirePermission("tenant-auth:write")(http.HandlerFunc(handleUpsertAuthPolicy(st))))

	// Observability (one GET + three section PUTs)
	mux.Handle("GET /api/v1/t/{tenant}/settings/observability",
		RequirePermission("metrics:read")(http.HandlerFunc(handleGetObservability(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/observability/metrics",
		RequirePermission("metrics:write")(http.HandlerFunc(handleUpsertObservabilityMetrics(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/observability/logs",
		RequirePermission("logs:write")(http.HandlerFunc(handleUpsertObservabilityLogs(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/observability/traces",
		RequirePermission("traces:write")(http.HandlerFunc(handleUpsertObservabilityTraces(st))))

	// Audit retention
	mux.Handle("GET /api/v1/t/{tenant}/audit/retention",
		RequirePermission("audit:retention:read")(http.HandlerFunc(handleGetAuditRetention(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/audit/retention",
		RequirePermission("audit:retention:write")(http.HandlerFunc(handleUpsertAuditRetention(st))))
}

// ─── Network ────────────────────────────────────────────────────────────────

type networkConfigResponse struct {
	TenantID             string          `json:"tenantId"`
	ListenAddresses      json.RawMessage `json:"listenAddresses"`
	HTTP3Enabled         bool            `json:"http3Enabled"`
	CaddyConfigOverrides json.RawMessage `json:"caddyConfigOverrides"`
	ReadTimeoutSeconds   int32           `json:"readTimeoutSeconds"`
	WriteTimeoutSeconds  int32           `json:"writeTimeoutSeconds"`
	IdleTimeoutSeconds   int32           `json:"idleTimeoutSeconds"`
	UpdatedAt            string          `json:"updatedAt"`
}

func networkConfigToResponse(c *store.NetworkConfig) networkConfigResponse {
	return networkConfigResponse{
		TenantID: c.TenantID, ListenAddresses: rawOrEmpty(c.ListenAddresses, "[]"),
		HTTP3Enabled: c.HTTP3Enabled, CaddyConfigOverrides: rawOrEmpty(c.CaddyConfigOverrides, "{}"),
		ReadTimeoutSeconds: c.ReadTimeoutSeconds, WriteTimeoutSeconds: c.WriteTimeoutSeconds,
		IdleTimeoutSeconds: c.IdleTimeoutSeconds,
		UpdatedAt:          c.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleGetNetworkConfig(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handleReadConfig(w, r, st, "get network_config",
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				c, err := tx.GetNetworkConfig(ctx, tenantID)
				if err != nil {
					return nil, err
				}
				return networkConfigToResponse(c), nil
			})
	}
}

func handleUpsertNetworkConfig(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ListenAddresses      json.RawMessage `json:"listenAddresses,omitempty"`
			HTTP3Enabled         bool            `json:"http3Enabled"`
			CaddyConfigOverrides json.RawMessage `json:"caddyConfigOverrides,omitempty"`
			ReadTimeoutSeconds   int32           `json:"readTimeoutSeconds"`
			WriteTimeoutSeconds  int32           `json:"writeTimeoutSeconds"`
			IdleTimeoutSeconds   int32           `json:"idleTimeoutSeconds"`
		}
		handleUpsertConfig(w, r, st, "upsert network_config", &req,
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				updated, err := tx.UpsertNetworkConfig(ctx, &store.NetworkConfig{
					TenantID:             tenantID,
					ListenAddresses:      string(req.ListenAddresses),
					HTTP3Enabled:         req.HTTP3Enabled,
					CaddyConfigOverrides: string(req.CaddyConfigOverrides),
					ReadTimeoutSeconds:   req.ReadTimeoutSeconds,
					WriteTimeoutSeconds:  req.WriteTimeoutSeconds,
					IdleTimeoutSeconds:   req.IdleTimeoutSeconds,
				})
				if err != nil {
					return nil, err
				}
				return networkConfigToResponse(updated), nil
			})
		// Network listen-address / overrides changes need to nudge Caddy
		// to reload its admin config. Best-effort; failures are logged
		// inside triggerCaddyReload.
		_ = triggerCaddyReload(r.Context(), "settings.network")
	}
}

// ─── Auth Policy ────────────────────────────────────────────────────────────

type authPolicyResponse struct {
	TenantID          string `json:"tenantId"`
	TOTPPolicy        string `json:"totpPolicy"`
	MinLength         int32  `json:"minLength"`
	RequireUppercase  bool   `json:"requireUppercase"`
	RequireLowercase  bool   `json:"requireLowercase"`
	RequireDigit      bool   `json:"requireDigit"`
	RequireSymbol     bool   `json:"requireSymbol"`
	IdleHours         int32  `json:"idleHours"`
	AbsoluteHours     int32  `json:"absoluteHours"`
	MaxFailedAttempts int32  `json:"maxFailedAttempts"`
	LockoutMinutes    int32  `json:"lockoutMinutes"`
	UpdatedAt         string `json:"updatedAt"`
}

func authPolicyToResponse(c *store.TenantAuthPolicy) authPolicyResponse {
	return authPolicyResponse{
		TenantID: c.TenantID, TOTPPolicy: c.TOTPPolicy, MinLength: c.MinLength,
		RequireUppercase: c.RequireUppercase, RequireLowercase: c.RequireLowercase,
		RequireDigit: c.RequireDigit, RequireSymbol: c.RequireSymbol,
		IdleHours: c.IdleHours, AbsoluteHours: c.AbsoluteHours,
		MaxFailedAttempts: c.MaxFailedAttempts, LockoutMinutes: c.LockoutMinutes,
		UpdatedAt: c.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleGetAuthPolicy(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handleReadConfig(w, r, st, "get auth_policy",
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				c, err := tx.GetTenantAuthPolicy(ctx, tenantID)
				if err != nil {
					return nil, err
				}
				return authPolicyToResponse(c), nil
			})
	}
}

func handleUpsertAuthPolicy(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			TOTPPolicy        string `json:"totpPolicy"`
			MinLength         int32  `json:"minLength"`
			RequireUppercase  bool   `json:"requireUppercase"`
			RequireLowercase  bool   `json:"requireLowercase"`
			RequireDigit      bool   `json:"requireDigit"`
			RequireSymbol     bool   `json:"requireSymbol"`
			IdleHours         int32  `json:"idleHours"`
			AbsoluteHours     int32  `json:"absoluteHours"`
			MaxFailedAttempts int32  `json:"maxFailedAttempts"`
			LockoutMinutes    int32  `json:"lockoutMinutes"`
		}
		handleUpsertConfig(w, r, st, "upsert auth_policy", &req,
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				updated, err := tx.UpsertTenantAuthPolicy(ctx, &store.TenantAuthPolicy{
					TenantID: tenantID, TOTPPolicy: req.TOTPPolicy, MinLength: req.MinLength,
					RequireUppercase: req.RequireUppercase, RequireLowercase: req.RequireLowercase,
					RequireDigit: req.RequireDigit, RequireSymbol: req.RequireSymbol,
					IdleHours: req.IdleHours, AbsoluteHours: req.AbsoluteHours,
					MaxFailedAttempts: req.MaxFailedAttempts, LockoutMinutes: req.LockoutMinutes,
				})
				if err != nil {
					return nil, err
				}
				return authPolicyToResponse(updated), nil
			})
	}
}

// ─── Observability ──────────────────────────────────────────────────────────

type observabilityResponse struct {
	TenantID              string          `json:"tenantId"`
	MetricsScrapeEndpoint string          `json:"metricsScrapeEndpoint"`
	MetricsScrapeAuth     json.RawMessage `json:"metricsScrapeAuth"`
	MetricsRetentionDays  int32           `json:"metricsRetentionDays"`
	LogLevels             json.RawMessage `json:"logLevels"`
	LogFormat             string          `json:"logFormat"`
	LogRotation           json.RawMessage `json:"logRotation"`
	TracesRetentionDays   int32           `json:"tracesRetentionDays"`
	TracesSampleRate      float64         `json:"tracesSampleRate"`
	UpdatedAt             string          `json:"updatedAt"`
}

func observabilityToResponse(c *store.ObservabilityConfig) observabilityResponse {
	return observabilityResponse{
		TenantID: c.TenantID, MetricsScrapeEndpoint: c.MetricsScrapeEndpoint,
		MetricsScrapeAuth:    rawOrEmpty(c.MetricsScrapeAuth, "{}"),
		MetricsRetentionDays: c.MetricsRetentionDays,
		LogLevels:            rawOrEmpty(c.LogLevels, "{}"),
		LogFormat:            c.LogFormat,
		LogRotation:          rawOrEmpty(c.LogRotation, "{}"),
		TracesRetentionDays:  c.TracesRetentionDays, TracesSampleRate: c.TracesSampleRate,
		UpdatedAt: c.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleGetObservability(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handleReadConfig(w, r, st, "get observability_config",
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				c, err := tx.GetObservabilityConfig(ctx, tenantID)
				if err != nil {
					return nil, err
				}
				return observabilityToResponse(c), nil
			})
	}
}

func handleUpsertObservabilityMetrics(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ScrapeEndpoint string          `json:"scrapeEndpoint"`
			ScrapeAuth     json.RawMessage `json:"scrapeAuth,omitempty"`
			RetentionDays  int32           `json:"retentionDays"`
		}
		handleUpsertConfig(w, r, st, "upsert metrics", &req,
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				current, _ := tx.GetObservabilityConfig(ctx, tenantID)
				current.TenantID = tenantID
				current.MetricsScrapeEndpoint = req.ScrapeEndpoint
				current.MetricsScrapeAuth = string(req.ScrapeAuth)
				current.MetricsRetentionDays = req.RetentionDays
				updated, err := tx.UpsertObservabilityConfig(ctx, current)
				if err != nil {
					return nil, err
				}
				return observabilityToResponse(updated), nil
			})
	}
}

func handleUpsertObservabilityLogs(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Levels   json.RawMessage `json:"levels,omitempty"`
			Format   string          `json:"format"`
			Rotation json.RawMessage `json:"rotation,omitempty"`
		}
		handleUpsertConfig(w, r, st, "upsert logs", &req,
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				current, _ := tx.GetObservabilityConfig(ctx, tenantID)
				current.TenantID = tenantID
				current.LogLevels = string(req.Levels)
				current.LogFormat = req.Format
				current.LogRotation = string(req.Rotation)
				updated, err := tx.UpsertObservabilityConfig(ctx, current)
				if err != nil {
					return nil, err
				}
				return observabilityToResponse(updated), nil
			})
	}
}

func handleUpsertObservabilityTraces(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			RetentionDays int32   `json:"retentionDays"`
			SampleRate    float64 `json:"sampleRate"`
		}
		handleUpsertConfig(w, r, st, "upsert traces", &req,
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				current, _ := tx.GetObservabilityConfig(ctx, tenantID)
				current.TenantID = tenantID
				current.TracesRetentionDays = req.RetentionDays
				current.TracesSampleRate = req.SampleRate
				updated, err := tx.UpsertObservabilityConfig(ctx, current)
				if err != nil {
					return nil, err
				}
				return observabilityToResponse(updated), nil
			})
	}
}

// ─── Audit Retention ────────────────────────────────────────────────────────

type auditRetentionResponse struct {
	TenantID                 string  `json:"tenantId"`
	RetentionDaysRead        int32   `json:"retentionDaysRead"`
	RetentionDaysWrite       int32   `json:"retentionDaysWrite"`
	RetentionDaysDestructive int32   `json:"retentionDaysDestructive"`
	AutoExport               string  `json:"autoExport"`
	AutoExportFormat         string  `json:"autoExportFormat"`
	AutoExportDestination    *string `json:"autoExportDestination,omitempty"`
	UpdatedAt                string  `json:"updatedAt"`
}

func auditRetentionToResponse(c *store.AuditRetentionConfig) auditRetentionResponse {
	return auditRetentionResponse{
		TenantID: c.TenantID, RetentionDaysRead: c.RetentionDaysRead,
		RetentionDaysWrite: c.RetentionDaysWrite, RetentionDaysDestructive: c.RetentionDaysDestructive,
		AutoExport: c.AutoExport, AutoExportFormat: c.AutoExportFormat,
		AutoExportDestination: c.AutoExportDestination,
		UpdatedAt:             c.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleGetAuditRetention(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handleReadConfig(w, r, st, "get audit_retention",
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				c, err := tx.GetAuditRetentionConfig(ctx, tenantID)
				if err != nil {
					return nil, err
				}
				return auditRetentionToResponse(c), nil
			})
	}
}

func handleUpsertAuditRetention(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			RetentionDaysRead        int32   `json:"retentionDaysRead"`
			RetentionDaysWrite       int32   `json:"retentionDaysWrite"`
			RetentionDaysDestructive int32   `json:"retentionDaysDestructive"`
			AutoExport               string  `json:"autoExport"`
			AutoExportFormat         string  `json:"autoExportFormat"`
			AutoExportDestination    *string `json:"autoExportDestination,omitempty"`
		}
		handleUpsertConfig(w, r, st, "upsert audit_retention", &req,
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				updated, err := tx.UpsertAuditRetentionConfig(ctx, &store.AuditRetentionConfig{
					TenantID:                 tenantID,
					RetentionDaysRead:        req.RetentionDaysRead,
					RetentionDaysWrite:       req.RetentionDaysWrite,
					RetentionDaysDestructive: req.RetentionDaysDestructive,
					AutoExport:               req.AutoExport, AutoExportFormat: req.AutoExportFormat,
					AutoExportDestination: req.AutoExportDestination,
				})
				if err != nil {
					return nil, err
				}
				return auditRetentionToResponse(updated), nil
			})
	}
}
