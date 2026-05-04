// Package postgres — Settings config singletons (stage-2).
//
// Per-tenant config rows: NetworkConfig, TenantAuthPolicy,
// ObservabilityConfig, AuditRetentionConfig.
package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// NetworkConfig
// ---------------------------------------------------------------------------

func (t *tx) GetNetworkConfig(ctx context.Context, tenantID string) (*store.NetworkConfig, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT tenant_id, listen_addresses, http3_enabled, caddy_config_overrides,
		   read_timeout_seconds, write_timeout_seconds, idle_timeout_seconds, updated_at
		 FROM network_configs WHERE tenant_id = ?`), tenantID)
	var (
		tID, listen, overrides string
		readT, writeT, idleT   int32
		http3                  bool
		updatedAt              time.Time
	)
	err := row.Scan(&tID, &listen, &http3, &overrides, &readT, &writeT, &idleT, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return &store.NetworkConfig{
			TenantID: tenantID, ListenAddresses: "[]", CaddyConfigOverrides: "{}",
			ReadTimeoutSeconds: 60, WriteTimeoutSeconds: 60, IdleTimeoutSeconds: 120,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get network_config: %w", err)
	}
	return &store.NetworkConfig{
		TenantID: tID, ListenAddresses: listen, HTTP3Enabled: http3,
		CaddyConfigOverrides: overrides,
		ReadTimeoutSeconds:   readT, WriteTimeoutSeconds: writeT, IdleTimeoutSeconds: idleT,
		UpdatedAt: updatedAt.UTC(),
	}, nil
}

func (t *tx) UpsertNetworkConfig(ctx context.Context, c *store.NetworkConfig) (*store.NetworkConfig, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("postgres: network_config requires tenant_id")
	}
	listen := c.ListenAddresses
	if listen == "" {
		listen = "[]"
	}
	overrides := c.CaddyConfigOverrides
	if overrides == "" {
		overrides = "{}"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO network_configs (tenant_id, listen_addresses, http3_enabled, caddy_config_overrides,
		   read_timeout_seconds, write_timeout_seconds, idle_timeout_seconds, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (tenant_id) DO UPDATE SET listen_addresses=EXCLUDED.listen_addresses,
		   http3_enabled=EXCLUDED.http3_enabled, caddy_config_overrides=EXCLUDED.caddy_config_overrides,
		   read_timeout_seconds=EXCLUDED.read_timeout_seconds,
		   write_timeout_seconds=EXCLUDED.write_timeout_seconds,
		   idle_timeout_seconds=EXCLUDED.idle_timeout_seconds, updated_at=EXCLUDED.updated_at`),
		c.TenantID, listen, c.HTTP3Enabled, overrides,
		c.ReadTimeoutSeconds, c.WriteTimeoutSeconds, c.IdleTimeoutSeconds, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: upsert network_config: %w", err)
	}
	t.emit("network_configs", c.TenantID, "UPSERT")
	return t.GetNetworkConfig(ctx, c.TenantID)
}

// ---------------------------------------------------------------------------
// TenantAuthPolicy
// ---------------------------------------------------------------------------

func (t *tx) GetTenantAuthPolicy(ctx context.Context, tenantID string) (*store.TenantAuthPolicy, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT tenant_id, totp_policy, min_length, require_uppercase, require_lowercase,
		   require_digit, require_symbol, idle_hours, absolute_hours, max_failed_attempts,
		   lockout_minutes, updated_at
		 FROM tenant_auth_policies WHERE tenant_id = ?`), tenantID)
	var (
		tID, totpPolicy     string
		minLen, idleH, absH int32
		maxFail, lockMin    int32
		reqUpper, reqLower  bool
		reqDigit, reqSymbol bool
		updatedAt           time.Time
	)
	err := row.Scan(&tID, &totpPolicy, &minLen, &reqUpper, &reqLower, &reqDigit, &reqSymbol,
		&idleH, &absH, &maxFail, &lockMin, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return &store.TenantAuthPolicy{
			TenantID: tenantID, TOTPPolicy: "optional", MinLength: 12,
			IdleHours: 24, AbsoluteHours: 168, MaxFailedAttempts: 5, LockoutMinutes: 15,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get tenant_auth_policy: %w", err)
	}
	return &store.TenantAuthPolicy{
		TenantID: tID, TOTPPolicy: totpPolicy, MinLength: minLen,
		RequireUppercase: reqUpper, RequireLowercase: reqLower,
		RequireDigit: reqDigit, RequireSymbol: reqSymbol,
		IdleHours: idleH, AbsoluteHours: absH,
		MaxFailedAttempts: maxFail, LockoutMinutes: lockMin,
		UpdatedAt: updatedAt.UTC(),
	}, nil
}

func (t *tx) UpsertTenantAuthPolicy(ctx context.Context, c *store.TenantAuthPolicy) (*store.TenantAuthPolicy, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("postgres: tenant_auth_policy requires tenant_id")
	}
	policy := c.TOTPPolicy
	if policy == "" {
		policy = "optional"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO tenant_auth_policies (tenant_id, totp_policy, min_length, require_uppercase,
		   require_lowercase, require_digit, require_symbol, idle_hours, absolute_hours,
		   max_failed_attempts, lockout_minutes, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (tenant_id) DO UPDATE SET totp_policy=EXCLUDED.totp_policy,
		   min_length=EXCLUDED.min_length,
		   require_uppercase=EXCLUDED.require_uppercase,
		   require_lowercase=EXCLUDED.require_lowercase,
		   require_digit=EXCLUDED.require_digit,
		   require_symbol=EXCLUDED.require_symbol,
		   idle_hours=EXCLUDED.idle_hours, absolute_hours=EXCLUDED.absolute_hours,
		   max_failed_attempts=EXCLUDED.max_failed_attempts,
		   lockout_minutes=EXCLUDED.lockout_minutes, updated_at=EXCLUDED.updated_at`),
		c.TenantID, policy, c.MinLength,
		c.RequireUppercase, c.RequireLowercase,
		c.RequireDigit, c.RequireSymbol,
		c.IdleHours, c.AbsoluteHours, c.MaxFailedAttempts, c.LockoutMinutes, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: upsert tenant_auth_policy: %w", err)
	}
	t.emit("tenant_auth_policies", c.TenantID, "UPSERT")
	return t.GetTenantAuthPolicy(ctx, c.TenantID)
}

// ---------------------------------------------------------------------------
// ObservabilityConfig
// ---------------------------------------------------------------------------

func (t *tx) GetObservabilityConfig(ctx context.Context, tenantID string) (*store.ObservabilityConfig, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT tenant_id, metrics_scrape_endpoint, metrics_scrape_auth, metrics_retention_days,
		   log_levels, log_format, log_rotation, traces_retention_days, traces_sample_rate, updated_at
		 FROM observability_configs WHERE tenant_id = ?`), tenantID)
	var (
		tID, scrapeEndpoint, scrapeAuth   string
		logLevels, logFormat, logRotation string
		metricsRetention, tracesRetention int32
		tracesSample                      float64
		updatedAt                         time.Time
	)
	err := row.Scan(&tID, &scrapeEndpoint, &scrapeAuth, &metricsRetention,
		&logLevels, &logFormat, &logRotation, &tracesRetention, &tracesSample, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return &store.ObservabilityConfig{
			TenantID: tenantID, MetricsScrapeAuth: "{}", MetricsRetentionDays: 30,
			LogLevels: "{}", LogFormat: "json", LogRotation: "{}",
			TracesRetentionDays: 7, TracesSampleRate: 1.0,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get observability_config: %w", err)
	}
	return &store.ObservabilityConfig{
		TenantID: tID, MetricsScrapeEndpoint: scrapeEndpoint, MetricsScrapeAuth: scrapeAuth,
		MetricsRetentionDays: metricsRetention, LogLevels: logLevels,
		LogFormat: logFormat, LogRotation: logRotation,
		TracesRetentionDays: tracesRetention, TracesSampleRate: tracesSample,
		UpdatedAt: updatedAt.UTC(),
	}, nil
}

func (t *tx) UpsertObservabilityConfig(ctx context.Context, c *store.ObservabilityConfig) (*store.ObservabilityConfig, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("postgres: observability_config requires tenant_id")
	}
	scrapeAuth := c.MetricsScrapeAuth
	if scrapeAuth == "" {
		scrapeAuth = "{}"
	}
	logLevels := c.LogLevels
	if logLevels == "" {
		logLevels = "{}"
	}
	logFormat := c.LogFormat
	if logFormat == "" {
		logFormat = "json"
	}
	logRotation := c.LogRotation
	if logRotation == "" {
		logRotation = "{}"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO observability_configs (tenant_id, metrics_scrape_endpoint, metrics_scrape_auth,
		   metrics_retention_days, log_levels, log_format, log_rotation,
		   traces_retention_days, traces_sample_rate, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (tenant_id) DO UPDATE SET
		   metrics_scrape_endpoint=EXCLUDED.metrics_scrape_endpoint,
		   metrics_scrape_auth=EXCLUDED.metrics_scrape_auth,
		   metrics_retention_days=EXCLUDED.metrics_retention_days,
		   log_levels=EXCLUDED.log_levels, log_format=EXCLUDED.log_format,
		   log_rotation=EXCLUDED.log_rotation,
		   traces_retention_days=EXCLUDED.traces_retention_days,
		   traces_sample_rate=EXCLUDED.traces_sample_rate, updated_at=EXCLUDED.updated_at`),
		c.TenantID, c.MetricsScrapeEndpoint, scrapeAuth, c.MetricsRetentionDays,
		logLevels, logFormat, logRotation, c.TracesRetentionDays, c.TracesSampleRate, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: upsert observability_config: %w", err)
	}
	t.emit("observability_configs", c.TenantID, "UPSERT")
	return t.GetObservabilityConfig(ctx, c.TenantID)
}

// ---------------------------------------------------------------------------
// AuditRetentionConfig
// ---------------------------------------------------------------------------

func (t *tx) GetAuditRetentionConfig(ctx context.Context, tenantID string) (*store.AuditRetentionConfig, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT tenant_id, retention_days_read, retention_days_write, retention_days_destructive,
		   auto_export, auto_export_format, auto_export_destination, updated_at
		 FROM audit_retention_configs WHERE tenant_id = ?`), tenantID)
	var (
		tID, autoExport, autoExportFormat string
		readD, writeD, destD              int32
		dest                              sql.NullString
		updatedAt                         time.Time
	)
	err := row.Scan(&tID, &readD, &writeD, &destD, &autoExport, &autoExportFormat, &dest, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return &store.AuditRetentionConfig{
			TenantID: tenantID, RetentionDaysRead: 30, RetentionDaysWrite: 90,
			RetentionDaysDestructive: 365, AutoExport: "never", AutoExportFormat: "jsonl",
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get audit_retention_config: %w", err)
	}
	out := &store.AuditRetentionConfig{
		TenantID: tID, RetentionDaysRead: readD, RetentionDaysWrite: writeD,
		RetentionDaysDestructive: destD, AutoExport: autoExport,
		AutoExportFormat: autoExportFormat,
		UpdatedAt:        updatedAt.UTC(),
	}
	if dest.Valid {
		out.AutoExportDestination = &dest.String
	}
	return out, nil
}

func (t *tx) UpsertAuditRetentionConfig(ctx context.Context, c *store.AuditRetentionConfig) (*store.AuditRetentionConfig, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("postgres: audit_retention_config requires tenant_id")
	}
	autoExport := c.AutoExport
	if autoExport == "" {
		autoExport = "never"
	}
	autoExportFormat := c.AutoExportFormat
	if autoExportFormat == "" {
		autoExportFormat = "jsonl"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO audit_retention_configs (tenant_id, retention_days_read, retention_days_write,
		   retention_days_destructive, auto_export, auto_export_format, auto_export_destination, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (tenant_id) DO UPDATE SET
		   retention_days_read=EXCLUDED.retention_days_read,
		   retention_days_write=EXCLUDED.retention_days_write,
		   retention_days_destructive=EXCLUDED.retention_days_destructive,
		   auto_export=EXCLUDED.auto_export,
		   auto_export_format=EXCLUDED.auto_export_format,
		   auto_export_destination=EXCLUDED.auto_export_destination,
		   updated_at=EXCLUDED.updated_at`),
		c.TenantID, c.RetentionDaysRead, c.RetentionDaysWrite, c.RetentionDaysDestructive,
		autoExport, autoExportFormat, c.AutoExportDestination, now,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: upsert audit_retention_config: %w", err)
	}
	t.emit("audit_retention_configs", c.TenantID, "UPSERT")
	return t.GetAuditRetentionConfig(ctx, c.TenantID)
}
