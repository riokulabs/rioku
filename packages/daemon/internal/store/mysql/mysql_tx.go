package mysql

import (
	"database/sql"

	"github.com/riokulabs/rioku/internal/store"
)

// tx wraps *sql.Tx and implements store.Tx. All CRUD methods are stubs
// returning "not implemented" errors until filled in by Phase 3c.
//
// MySQL uses ? placeholders natively (same as SQLite) — no placeholder
// rewriting is needed. Pass SQL directly to ExecContext/QueryContext/
// QueryRowContext without any transformation.
type tx struct {
	sqlTx  *sql.Tx
	notify chan store.ChangeEvent
}

func (t *tx) Commit() error   { return t.sqlTx.Commit() }
func (t *tx) Rollback() error { return t.sqlTx.Rollback() }

// Per-domain tx method implementations live in the following files:
//
//   - mysql_tx_routes.go              -- Routes
//   - mysql_tx_services.go            -- Services + upstreams
//   - mysql_tx_policies.go            -- Policies, policy bindings, RBAC + access policies
//   - mysql_tx_keys.go                -- API keys
//   - mysql_tx_audit.go               -- Config versions + audit log
//   - mysql_tx_users.go               -- Users + sessions
//   - mysql_tx_roles.go               -- Roles, permissions, user roles, TOTP backup codes
//   - mysql_tx_tenants.go             -- Tenants + memberships + membership roles
//   - mysql_tx_dashboard_shares.go    -- Dashboard shares
//
// Other domains are implemented in their own dedicated files:
//
//   - mysql_webhooks_cluster_impersonation.go -- Webhooks, cluster enrollment tokens, impersonation sessions
//   - mysql_settings_configs.go               -- Settings config singletons
//   - mysql_pki.go                            -- PKI / TLS subsystem
//   - mysql_plugins.go                        -- Plugins + plugin signers
//   - mysql_notifications.go                  -- Notifications subsystem
//   - mysql_ai.go                             -- AI subsystem
//   - mysql_sites.go                          -- Sites + middlewares
//   - mysql_dashboards.go                     -- Dashboards
