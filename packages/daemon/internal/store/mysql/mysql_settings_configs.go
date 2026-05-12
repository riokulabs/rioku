// Package mysql — Settings config singletons.
package mysql

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// NetworkConfig
// ---------------------------------------------------------------------------

func (t *tx) GetNetworkConfig(ctx context.Context, tenantID string) (*store.NetworkConfig, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT tenant_id, listen_addresses, http3_enabled, caddy_config_overrides,
		   read_timeout_seconds, write_timeout_seconds, idle_timeout_seconds, updated_at
		 FROM network_configs WHERE tenant_id = ?`, tenantID)
	var (
		tID, listen, overrides, updatedAt string
		readT, writeT, idleT              int32
		http3                             int
	)
	err := row.Scan(&tID, &listen, &http3, &overrides, &readT, &writeT, &idleT, &updatedAt)
	if err == sql.ErrNoRows {
		return &store.NetworkConfig{
			TenantID: tenantID, ListenAddresses: "[]", CaddyConfigOverrides: "{}",
			ReadTimeoutSeconds: 60, WriteTimeoutSeconds: 60, IdleTimeoutSeconds: 120,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("mysql: get network_config: %w", err)
	}
	return &store.NetworkConfig{
		TenantID: tID, ListenAddresses: listen, HTTP3Enabled: http3 == 1,
		CaddyConfigOverrides: overrides,
		ReadTimeoutSeconds:   readT, WriteTimeoutSeconds: writeT, IdleTimeoutSeconds: idleT,
		UpdatedAt: parseTime(updatedAt),
	}, nil
}

func (t *tx) UpsertNetworkConfig(ctx context.Context, c *store.NetworkConfig) (*store.NetworkConfig, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("mysql: network_config requires tenant_id")
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
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO network_configs (tenant_id, listen_addresses, http3_enabled, caddy_config_overrides,
		   read_timeout_seconds, write_timeout_seconds, idle_timeout_seconds, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE listen_addresses = VALUES(listen_addresses),
		   http3_enabled = VALUES(http3_enabled), caddy_config_overrides = VALUES(caddy_config_overrides),
		   read_timeout_seconds = VALUES(read_timeout_seconds),
		   write_timeout_seconds = VALUES(write_timeout_seconds),
		   idle_timeout_seconds = VALUES(idle_timeout_seconds), updated_at = VALUES(updated_at)`,
		c.TenantID, listen, boolToInt(c.HTTP3Enabled), overrides,
		c.ReadTimeoutSeconds, c.WriteTimeoutSeconds, c.IdleTimeoutSeconds, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: upsert network_config: %w", err)
	}
	t.emit("network_configs", c.TenantID, "UPSERT")
	return t.GetNetworkConfig(ctx, c.TenantID)
}

// ---------------------------------------------------------------------------
// TenantAuthPolicy
// ---------------------------------------------------------------------------

func (t *tx) GetTenantAuthPolicy(ctx context.Context, tenantID string) (*store.TenantAuthPolicy, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT tenant_id, totp_policy, min_length, require_uppercase, require_lowercase,
		   require_digit, require_symbol, idle_hours, absolute_hours, max_failed_attempts,
		   lockout_minutes, updated_at
		 FROM tenant_auth_policies WHERE tenant_id = ?`, tenantID)
	var (
		tID, totpPolicy, updatedAt              string
		minLen, idleH, absH, maxFail, lockMin   int32
		reqUpper, reqLower, reqDigit, reqSymbol int
	)
	err := row.Scan(&tID, &totpPolicy, &minLen, &reqUpper, &reqLower, &reqDigit, &reqSymbol,
		&idleH, &absH, &maxFail, &lockMin, &updatedAt)
	if err == sql.ErrNoRows {
		return &store.TenantAuthPolicy{
			TenantID: tenantID, TOTPPolicy: "optional", MinLength: 12,
			IdleHours: 24, AbsoluteHours: 168, MaxFailedAttempts: 5, LockoutMinutes: 15,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("mysql: get tenant_auth_policy: %w", err)
	}
	return &store.TenantAuthPolicy{
		TenantID: tID, TOTPPolicy: totpPolicy, MinLength: minLen,
		RequireUppercase: reqUpper == 1, RequireLowercase: reqLower == 1,
		RequireDigit: reqDigit == 1, RequireSymbol: reqSymbol == 1,
		IdleHours: idleH, AbsoluteHours: absH,
		MaxFailedAttempts: maxFail, LockoutMinutes: lockMin,
		UpdatedAt: parseTime(updatedAt),
	}, nil
}

func (t *tx) UpsertTenantAuthPolicy(ctx context.Context, c *store.TenantAuthPolicy) (*store.TenantAuthPolicy, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("mysql: tenant_auth_policy requires tenant_id")
	}
	policy := c.TOTPPolicy
	if policy == "" {
		policy = "optional"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO tenant_auth_policies (tenant_id, totp_policy, min_length, require_uppercase,
		   require_lowercase, require_digit, require_symbol, idle_hours, absolute_hours,
		   max_failed_attempts, lockout_minutes, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE totp_policy = VALUES(totp_policy),
		   min_length = VALUES(min_length),
		   require_uppercase = VALUES(require_uppercase),
		   require_lowercase = VALUES(require_lowercase),
		   require_digit = VALUES(require_digit),
		   require_symbol = VALUES(require_symbol),
		   idle_hours = VALUES(idle_hours), absolute_hours = VALUES(absolute_hours),
		   max_failed_attempts = VALUES(max_failed_attempts),
		   lockout_minutes = VALUES(lockout_minutes), updated_at = VALUES(updated_at)`,
		c.TenantID, policy, c.MinLength,
		boolToInt(c.RequireUppercase), boolToInt(c.RequireLowercase),
		boolToInt(c.RequireDigit), boolToInt(c.RequireSymbol),
		c.IdleHours, c.AbsoluteHours, c.MaxFailedAttempts, c.LockoutMinutes, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: upsert tenant_auth_policy: %w", err)
	}
	t.emit("tenant_auth_policies", c.TenantID, "UPSERT")
	return t.GetTenantAuthPolicy(ctx, c.TenantID)
}

// ---------------------------------------------------------------------------
// ObservabilityConfig
// ---------------------------------------------------------------------------

func (t *tx) GetObservabilityConfig(ctx context.Context, tenantID string) (*store.ObservabilityConfig, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT tenant_id, metrics_scrape_endpoint, metrics_scrape_auth, metrics_retention_days,
		   log_levels, log_format, log_rotation, traces_retention_days, traces_sample_rate, updated_at
		 FROM observability_configs WHERE tenant_id = ?`, tenantID)
	var (
		tID, scrapeEndpoint, scrapeAuth, logLevels, logFormat, logRotation, updatedAt string
		metricsRetention, tracesRetention                                             int32
		tracesSample                                                                  float64
	)
	err := row.Scan(&tID, &scrapeEndpoint, &scrapeAuth, &metricsRetention,
		&logLevels, &logFormat, &logRotation, &tracesRetention, &tracesSample, &updatedAt)
	if err == sql.ErrNoRows {
		return &store.ObservabilityConfig{
			TenantID: tenantID, MetricsScrapeAuth: "{}", MetricsRetentionDays: 30,
			LogLevels: "{}", LogFormat: "json", LogRotation: "{}",
			TracesRetentionDays: 7, TracesSampleRate: 1.0,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("mysql: get observability_config: %w", err)
	}
	return &store.ObservabilityConfig{
		TenantID: tID, MetricsScrapeEndpoint: scrapeEndpoint, MetricsScrapeAuth: scrapeAuth,
		MetricsRetentionDays: metricsRetention, LogLevels: logLevels,
		LogFormat: logFormat, LogRotation: logRotation,
		TracesRetentionDays: tracesRetention, TracesSampleRate: tracesSample,
		UpdatedAt: parseTime(updatedAt),
	}, nil
}

func (t *tx) UpsertObservabilityConfig(ctx context.Context, c *store.ObservabilityConfig) (*store.ObservabilityConfig, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("mysql: observability_config requires tenant_id")
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
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO observability_configs (tenant_id, metrics_scrape_endpoint, metrics_scrape_auth,
		   metrics_retention_days, log_levels, log_format, log_rotation,
		   traces_retention_days, traces_sample_rate, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   metrics_scrape_endpoint = VALUES(metrics_scrape_endpoint),
		   metrics_scrape_auth = VALUES(metrics_scrape_auth),
		   metrics_retention_days = VALUES(metrics_retention_days),
		   log_levels = VALUES(log_levels), log_format = VALUES(log_format),
		   log_rotation = VALUES(log_rotation),
		   traces_retention_days = VALUES(traces_retention_days),
		   traces_sample_rate = VALUES(traces_sample_rate), updated_at = VALUES(updated_at)`,
		c.TenantID, c.MetricsScrapeEndpoint, scrapeAuth, c.MetricsRetentionDays,
		logLevels, logFormat, logRotation, c.TracesRetentionDays, c.TracesSampleRate, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: upsert observability_config: %w", err)
	}
	t.emit("observability_configs", c.TenantID, "UPSERT")
	return t.GetObservabilityConfig(ctx, c.TenantID)
}

// ---------------------------------------------------------------------------
// AuditRetentionConfig
// ---------------------------------------------------------------------------

func (t *tx) GetAuditRetentionConfig(ctx context.Context, tenantID string) (*store.AuditRetentionConfig, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT tenant_id, retention_days_read, retention_days_write, retention_days_destructive,
		   auto_export, auto_export_format, auto_export_destination, updated_at
		 FROM audit_retention_configs WHERE tenant_id = ?`, tenantID)
	var (
		tID, autoExport, autoExportFormat, updatedAt string
		readD, writeD, destD                         int32
		dest                                         *string
	)
	err := row.Scan(&tID, &readD, &writeD, &destD, &autoExport, &autoExportFormat, &dest, &updatedAt)
	if err == sql.ErrNoRows {
		return &store.AuditRetentionConfig{
			TenantID: tenantID, RetentionDaysRead: 30, RetentionDaysWrite: 90,
			RetentionDaysDestructive: 365, AutoExport: "never", AutoExportFormat: "jsonl",
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("mysql: get audit_retention_config: %w", err)
	}
	return &store.AuditRetentionConfig{
		TenantID: tID, RetentionDaysRead: readD, RetentionDaysWrite: writeD,
		RetentionDaysDestructive: destD, AutoExport: autoExport,
		AutoExportFormat: autoExportFormat, AutoExportDestination: dest,
		UpdatedAt: parseTime(updatedAt),
	}, nil
}

func (t *tx) UpsertAuditRetentionConfig(ctx context.Context, c *store.AuditRetentionConfig) (*store.AuditRetentionConfig, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("mysql: audit_retention_config requires tenant_id")
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
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO audit_retention_configs (tenant_id, retention_days_read, retention_days_write,
		   retention_days_destructive, auto_export, auto_export_format, auto_export_destination, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   retention_days_read = VALUES(retention_days_read),
		   retention_days_write = VALUES(retention_days_write),
		   retention_days_destructive = VALUES(retention_days_destructive),
		   auto_export = VALUES(auto_export),
		   auto_export_format = VALUES(auto_export_format),
		   auto_export_destination = VALUES(auto_export_destination),
		   updated_at = VALUES(updated_at)`,
		c.TenantID, c.RetentionDaysRead, c.RetentionDaysWrite, c.RetentionDaysDestructive,
		autoExport, autoExportFormat, c.AutoExportDestination, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: upsert audit_retention_config: %w", err)
	}
	t.emit("audit_retention_configs", c.TenantID, "UPSERT")
	return t.GetAuditRetentionConfig(ctx, c.TenantID)
}
