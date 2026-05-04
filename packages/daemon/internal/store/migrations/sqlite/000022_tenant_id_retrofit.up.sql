--------------------------------------------------------------------------------
-- Tenant_id retrofit on existing tables (stage-2 final).
--
-- Every tenant-scoped table from migrations 1-12 gets a `tenant_id`
-- column FK'd to tenants(id). Existing rows are backfilled to
-- 'tenant_default'. The columns are then enforced NOT NULL via the
-- recreate-table dance (sqlite doesn't support ALTER COLUMN).
--
-- Tables affected:
--   routes, services, policies, api_keys, audit_log, sessions,
--   access_policies
--
-- Tables intentionally NOT changed:
--   users           — global (tenant relationship via memberships)
--   permissions     — global catalog
--   role_permissions, user_roles — FK to roles/users (indirect)
--   upstreams, policy_bindings   — FK to services/policies (indirect)
--   config_versions — snapshot of full config, single-node concept
--   totp_*          — global per user
--
-- Roles uses a NULLABLE tenant_id: NULL = built-in/global role,
-- non-null = tenant-scoped custom role. The seeded built-ins
-- (role_superadmin, role_admin, role_operator, role_viewer) keep
-- tenant_id NULL.
--------------------------------------------------------------------------------

-- Routes
ALTER TABLE routes ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_routes_tenant ON routes (tenant_id);

-- Services
ALTER TABLE services ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_services_tenant ON services (tenant_id);

-- Policies
ALTER TABLE policies ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_policies_tenant ON policies (tenant_id);

-- API Keys (already has owner_id)
ALTER TABLE api_keys ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);

-- Audit log
ALTER TABLE audit_log ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_audit_log_tenant ON audit_log (tenant_id, occurred_at DESC);

-- Sessions
ALTER TABLE sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_sessions_tenant ON sessions (tenant_id);

-- Access policies (added in migration 8 without tenant_id)
ALTER TABLE access_policies ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default' REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_access_policies_tenant ON access_policies (tenant_id);

-- Roles: nullable tenant_id (NULL = built-in/global). The seeded
-- built-in roles (role_superadmin, role_admin, role_operator,
-- role_viewer) keep NULL. Custom roles created via REST get the
-- tenant id of the creator.
ALTER TABLE roles ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_roles_tenant ON roles (tenant_id);
