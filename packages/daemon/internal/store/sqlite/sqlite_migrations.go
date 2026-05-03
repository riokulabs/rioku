package sqlite

import (
	"context"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

func (d *driver) migrateUp(ctx context.Context) error {
	// Check if already at target version (idempotent).
	current, _ := d.CurrentVersion(ctx)

	// Migration 1: initial schema.
	if current < 1 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000001_initial.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 1: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 1: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (1, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 1: %w", err)
		}
	}

	// Migration 2: users and sessions tables.
	if current < 2 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000002_auth_users_sessions.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 2: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 2: %w", err)
		}
	}

	// Migration 3: RBAC tables (permissions, roles, role_permissions, user_roles).
	if current < 3 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000003_rbac.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 3: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 3: %w", err)
		}
	}

	// Migration 4: TOTP backup codes.
	if current < 4 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000004_totp_backup.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 4: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 4: %w", err)
		}
	}

	// Migration 5: service timeout columns.
	if current < 5 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000005_service_timeouts.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 5: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 5: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (5, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 5: %w", err)
		}
	}

	// Migration 6: add 'deleted' to user status CHECK constraint.
	if current < 6 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000006_user_deleted_status.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 6: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 6: %w", err)
		}
	}

	// Migration 7: add owner_id column to api_keys.
	if current < 7 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000007_api_key_owner.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 7: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 7: %w", err)
		}
	}

	// Migration 8: access_policies table for conditional access rules.
	if current < 8 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000008_access_policies.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 8: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 8: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (8, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 8: %w", err)
		}
	}

	// Migration 9: passive_health_check column on services (#67).
	if current < 9 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000009_passive_health_check.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 9: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 9: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (9, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 9: %w", err)
		}
	}

	// Migration 10: retry_policy column on services (#69).
	if current < 10 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000010_retry_policy.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 10: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 10: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (10, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 10: %w", err)
		}
	}

	// Migration 11: upstream_tls + connection_pool columns (#70).
	if current < 11 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000011_upstream_tls_pool.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 11: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 11: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (11, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 11: %w", err)
		}
	}

	// Migration 12: api_keys.last_used_at + usage_count columns (#85).
	if current < 12 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000012_api_key_usage.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 12: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 12: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (12, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 12: %w", err)
		}
	}

	// Migration 13: tenants + memberships foundation (stage-2).
	if current < 13 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000013_tenants.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 13: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 13: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (13, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 13: %w", err)
		}
	}

	// Migration 14: sites + middlewares (stage-2).
	if current < 14 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000014_sites_middlewares.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 14: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 14: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (14, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 14: %w", err)
		}
	}

	// Migration 15: dashboards + widgets + versions (stage-2).
	if current < 15 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000015_dashboards.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 15: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 15: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (15, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 15: %w", err)
		}
	}

	// Migration 16: AI subsystem (7 tables, stage-2).
	if current < 16 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000016_ai.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 16: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 16: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (16, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 16: %w", err)
		}
	}

	// Migration 17: Notifications (5 tables, stage-2).
	if current < 17 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000017_notifications.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 17: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 17: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (17, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 17: %w", err)
		}
	}

	// Migration 18: Plugins + PluginSigners (stage-2).
	if current < 18 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000018_plugins.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 18: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 18: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (18, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 18: %w", err)
		}
	}

	// Migration 19: PKI/TLS (4 tables, stage-2).
	if current < 19 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000019_pki_tls.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 19: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 19: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (19, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 19: %w", err)
		}
	}

	// Migration 20: settings configs singletons (stage-2).
	if current < 20 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000020_settings_configs.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 20: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 20: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (20, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 20: %w", err)
		}
	}

	// Migration 21: webhooks + cluster enrollment tokens + impersonation sessions (stage-2).
	if current < 21 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000021_webhooks_cluster_impersonation.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 21: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 21: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (21, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 21: %w", err)
		}
	}

	// Migration 22: tenant_id retrofit on existing tables (stage-2 final).
	if current < 22 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000022_tenant_id_retrofit.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 22: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 22: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (22, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 22: %w", err)
		}
	}

	// Migration 23: session affinity / hash LB columns on services (#71).
	if current < 23 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000023_lb_session_affinity.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 23: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 23: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (23, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 23: %w", err)
		}
	}

	// Migration 24: rbac_policies table (stage-2 admin completion).
	if current < 24 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000024_rbac_policies.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 24: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 24: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (24, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 24: %w", err)
		}
	}

	// Migration 25: dashboard_shares table (stage-2 admin completion).
	if current < 25 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000025_dashboard_shares.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 25: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 25: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (25, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 25: %w", err)
		}
	}

	// Migration 26: service-level Caddy primitives (request_headers, response_headers,
	// response_rules, compression) — Phase 7a / #161.
	if current < 26 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000026_caddy_primitives.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 26: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 26: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (26, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 26: %w", err)
		}
	}

	// Migration 27: dynamic upstreams (source_type + source_json columns) — Phase 7b / #162.
	if current < 27 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000027_dynamic_upstreams.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 27: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 27: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (27, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 27: %w", err)
		}
	}

	// Migration 28: role inheritance (parent_role_id) — #117.
	if current < 28 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000028_role_inheritance.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 28: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 28: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (28, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 28: %w", err)
		}
	}

	// Migration 29: password_history + tenant_auth_policies.password_history_count — #115.
	if current < 29 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000029_password_history.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 29: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 29: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (29, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 29: %w", err)
		}
	}

	// Migrations 30-33: API management — Plans / Applications /
	// Subscriptions / api_keys ↔ subscription FK extension (#164).
	for _, m := range []struct {
		ver  int
		name string
	}{
		{30, "plans"},
		{31, "applications"},
		{32, "subscriptions"},
		{33, "api_keys_subscriptions"},
	} {
		if current < m.ver {
			data, err := store.MigrationFS.ReadFile(fmt.Sprintf("migrations/sqlite/%06d_%s.up.sql", m.ver, m.name))
			if err != nil {
				return fmt.Errorf("sqlite: read up migration %d: %w", m.ver, err)
			}
			if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
				return fmt.Errorf("sqlite: apply up migration %d: %w", m.ver, err)
			}
			if _, err := d.db.ExecContext(ctx,
				`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (?, 0)`, m.ver); err != nil {
				return fmt.Errorf("sqlite: record schema version %d: %w", m.ver, err)
			}
		}
	}

	// Migration 39: audit_log unification — #182, D6.
	if current < 39 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000039_audit_unification.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 39: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 39: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (39, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 39: %w", err)
		}
	}

	// Migration 40: routes.log_sample_rate — #119.
	if current < 40 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000040_log_sampling.up.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read up migration 40: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply up migration 40: %w", err)
		}
		_, err = d.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (40, 0)`)
		if err != nil {
			return fmt.Errorf("sqlite: record schema version 40: %w", err)
		}
	}

	// Migrations 41-43: per-route plugin configs (#171 OAS,
	// #172 WAF) + AI spend tables (#166).
	for _, m := range []struct {
		ver  int
		name string
	}{
		{41, "route_oas_configs"},
		{42, "route_waf_configs"},
		{43, "ai_spend"},
	} {
		if current < m.ver {
			data, err := store.MigrationFS.ReadFile(fmt.Sprintf("migrations/sqlite/%06d_%s.up.sql", m.ver, m.name))
			if err != nil {
				return fmt.Errorf("sqlite: read up migration %d: %w", m.ver, err)
			}
			if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
				return fmt.Errorf("sqlite: apply up migration %d: %w", m.ver, err)
			}
			if _, err := d.db.ExecContext(ctx,
				`INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (?, 0)`, m.ver); err != nil {
				return fmt.Errorf("sqlite: record schema version %d: %w", m.ver, err)
			}
		}
	}

	return nil
}

func (d *driver) migrateDown(ctx context.Context) error {
	current, _ := d.CurrentVersion(ctx)

	// Migrations 43-41 down: drop AI spend + per-route plugin tables.
	for _, m := range []struct {
		ver  int
		name string
	}{
		{43, "ai_spend"},
		{42, "route_waf_configs"},
		{41, "route_oas_configs"},
	} {
		if current >= m.ver {
			data, err := store.MigrationFS.ReadFile(fmt.Sprintf("migrations/sqlite/%06d_%s.down.sql", m.ver, m.name))
			if err != nil {
				return fmt.Errorf("sqlite: read down migration %d: %w", m.ver, err)
			}
			if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
				return fmt.Errorf("sqlite: apply down migration %d: %w", m.ver, err)
			}
		}
	}

	// Migration 40 down: drop routes.log_sample_rate.
	if current >= 40 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000040_log_sampling.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 40: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 40: %w", err)
		}
	}

	// Migration 39 down: drop audit_log payload columns.
	if current >= 39 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000039_audit_unification.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 39: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 39: %w", err)
		}
	}

	// Migrations 33-30 down: drop API-management tables (reverse order).
	for _, m := range []struct {
		ver  int
		name string
	}{
		{33, "api_keys_subscriptions"},
		{32, "subscriptions"},
		{31, "applications"},
		{30, "plans"},
	} {
		if current >= m.ver {
			data, err := store.MigrationFS.ReadFile(fmt.Sprintf("migrations/sqlite/%06d_%s.down.sql", m.ver, m.name))
			if err != nil {
				return fmt.Errorf("sqlite: read down migration %d: %w", m.ver, err)
			}
			if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
				return fmt.Errorf("sqlite: apply down migration %d: %w", m.ver, err)
			}
		}
	}

	// Migration 29 down: drop password_history table + column.
	if current >= 29 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000029_password_history.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 29: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 29: %w", err)
		}
	}

	// Migration 28 down: drop parent_role_id column.
	if current >= 28 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000028_role_inheritance.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 28: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 28: %w", err)
		}
	}

	// Migration 27 down: remove dynamic upstream columns from upstreams table.
	if current >= 27 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000027_dynamic_upstreams.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 27: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 27: %w", err)
		}
	}

	// Migration 26 down: drop caddy primitive columns.
	if current >= 26 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000026_caddy_primitives.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 26: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 26: %w", err)
		}
	}

	// Migration 25 down: drop dashboard_shares.
	if current >= 25 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000025_dashboard_shares.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 25: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 25: %w", err)
		}
	}

	// Migration 24 down: drop rbac_policies.
	if current >= 24 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000024_rbac_policies.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 24: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 24: %w", err)
		}
	}

	// Migration 23 down: drop lb_cookie_name + lb_header_name columns.
	if current >= 23 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000023_lb_session_affinity.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 23: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 23: %w", err)
		}
	}

	// Migration 22 down: drop tenant_id columns from existing tables.
	if current >= 22 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000022_tenant_id_retrofit.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 22: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 22: %w", err)
		}
	}

	// Migration 21 down: drop webhooks + cluster_enrollment_tokens + impersonation_sessions.
	if current >= 21 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000021_webhooks_cluster_impersonation.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 21: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 21: %w", err)
		}
	}

	// Migration 20 down: drop settings config singletons.
	if current >= 20 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000020_settings_configs.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 20: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 20: %w", err)
		}
	}

	// Migration 19 down: drop pki/tls tables.
	if current >= 19 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000019_pki_tls.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 19: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 19: %w", err)
		}
	}

	// Migration 18 down: drop plugins + plugin_signers.
	if current >= 18 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000018_plugins.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 18: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 18: %w", err)
		}
	}

	// Migration 17 down: drop notifications tables.
	if current >= 17 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000017_notifications.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 17: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 17: %w", err)
		}
	}

	// Migration 16 down: drop AI subsystem tables.
	if current >= 16 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000016_ai.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 16: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 16: %w", err)
		}
	}

	// Migration 15 down: drop dashboards + widgets + versions.
	if current >= 15 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000015_dashboards.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 15: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 15: %w", err)
		}
	}

	// Migration 14 down: drop sites + middlewares.
	if current >= 14 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000014_sites_middlewares.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 14: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 14: %w", err)
		}
	}

	// Migration 13 down: drop tenants + memberships + membership_roles.
	if current >= 13 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000013_tenants.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 13: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 13: %w", err)
		}
	}

	// Migration 12 down: drop api_keys.last_used_at + usage_count.
	if current >= 12 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000012_api_key_usage.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 12: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 12: %w", err)
		}
	}

	// Migration 11 down: drop upstream_tls + connection_pool columns.
	if current >= 11 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000011_upstream_tls_pool.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 11: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 11: %w", err)
		}
	}

	// Migration 10 down: drop retry_policy column.
	if current >= 10 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000010_retry_policy.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 10: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 10: %w", err)
		}
	}

	// Migration 9 down: drop passive_health_check column.
	if current >= 9 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000009_passive_health_check.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 9: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 9: %w", err)
		}
	}

	// Migration 8 down: drop access_policies table.
	if current >= 8 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000008_access_policies.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 8: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 8: %w", err)
		}
	}

	// Migration 7 down: remove owner_id from api_keys.
	if current >= 7 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000007_api_key_owner.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 7: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 7: %w", err)
		}
	}

	// Migration 6 down: revert user status CHECK constraint.
	if current >= 6 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000006_user_deleted_status.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 6: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 6: %w", err)
		}
	}

	// Migration 5 down: drop service timeout columns.
	if current >= 5 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000005_service_timeouts.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 5: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 5: %w", err)
		}
	}

	// Migration 4 down: drop TOTP backup codes.
	if current >= 4 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000004_totp_backup.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 4: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 4: %w", err)
		}
	}

	// Migration 3 down: drop RBAC tables.
	if current >= 3 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000003_rbac.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 3: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 3: %w", err)
		}
	}

	// Migration 2 down: drop users and sessions tables.
	if current >= 2 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000002_auth_users_sessions.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 2: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 2: %w", err)
		}
	}

	// Migration 1 down: drop initial schema.
	if current >= 1 {
		data, err := store.MigrationFS.ReadFile("migrations/sqlite/000001_initial.down.sql")
		if err != nil {
			return fmt.Errorf("sqlite: read down migration 1: %w", err)
		}
		if _, err := d.db.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("sqlite: apply down migration 1: %w", err)
		}
	}

	return nil
}
