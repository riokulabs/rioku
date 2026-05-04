-- --------------------------------------------------------------------------------
-- Tenancy foundation (#stage-2)
--
-- Every multi-tenant entity in stage-2 keys off `tenants(id)`. We seed a
-- single "default" tenant during this migration so every existing row in
-- the database can be backfilled in migration 14 — without that, adding
-- a NOT NULL tenant_id column would fail on populated databases.
--
-- The slug `default` is reserved and used by the URL resolver as a
-- fallback when no tenant prefix is supplied.
-- --------------------------------------------------------------------------------

CREATE TABLE tenants (
    id VARCHAR(64) PRIMARY KEY,                                          -- UUID or fixed "tenant_default"
    slug       TEXT NOT NULL UNIQUE,                                      -- URL-safe identifier
    name       TEXT NOT NULL,                                             -- display name
    plan       TEXT NOT NULL DEFAULT 'community' CHECK (plan IN ('community','pro','enterprise')),
    url_mode   TEXT NOT NULL DEFAULT 'path'      CHECK (url_mode IN ('path','subdomain')),
    accent     TEXT,                                                      -- hex color for theming, nullable
    logo_url   TEXT,                                                      -- nullable
    default_dashboard_id VARCHAR(64),                                            -- nullable; FK enforced in app layer to allow cycles
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_tenants_slug ON tenants (slug);

INSERT INTO tenants (id, slug, name, plan, url_mode)
VALUES ('tenant_default', 'default', 'Default', 'community', 'path');

-- --------------------------------------------------------------------------------
-- Memberships: users <-> tenants with state machine.
--
-- A user may hold memberships in multiple tenants. The `state` column
-- mirrors the admin-panel mock: pending (invited but not accepted) ->
-- active (in-good-standing) -> deactivated (locked, kept for audit) ->
-- removed (soft-deleted, kept for audit). Hard delete is reserved for
-- super-admin via DELETE /api/v1/admin/tenants/:id which cascades.
--
-- Backfill: every existing user gets an `active` membership in the
-- default tenant via the migration runner (the SQL below does it
-- inline since user IDs are deterministic at this point).
-- --------------------------------------------------------------------------------

CREATE TABLE memberships (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    state       TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('pending','active','deactivated','removed')),
    invited_by  VARCHAR(64),                                                    -- user_id of inviter, nullable
    invited_at  TEXT,                                                    -- when invitation was sent
    joined_at   TEXT,                                                    -- when state first transitioned to active
    invite_token_hash VARCHAR(255),                                              -- one-time token hash for invite acceptance
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (tenant_id, user_id)
 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_memberships_tenant ON memberships (tenant_id);
CREATE INDEX idx_memberships_user   ON memberships (user_id);
CREATE INDEX idx_memberships_state  ON memberships (state);

-- Backfill: every existing user gets an active membership in the default tenant.
INSERT INTO memberships (id, tenant_id, user_id, state, joined_at)
SELECT
    'm_' || u.id,
    'tenant_default',
    u.id,
    'active',
    u.created_at
FROM users u;

-- --------------------------------------------------------------------------------
-- Membership <-> Role bindings (per-tenant role assignments).
--
-- The existing `user_roles` table predates memberships and joins users
-- directly to roles. We don't drop it yet — that's a separate cleanup
-- once the new code paths fully replace the old ones — but we add a
-- per-membership join so handlers in the new tenant-scoped routes can
-- query "what roles does this user have *in this tenant*?".
--
-- Backfill walks user_roles and inserts a matching row per membership.
-- --------------------------------------------------------------------------------

CREATE TABLE membership_roles (
    membership_id VARCHAR(64) NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    role_id VARCHAR(64) NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
    granted_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    granted_by    TEXT,
    PRIMARY KEY (membership_id, role_id)
 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_membership_roles_role ON membership_roles (role_id);

-- Backfill from user_roles: for every (user_id, role_id) pair, insert
-- a row keyed by the user's default-tenant membership.
INSERT INTO membership_roles (membership_id, role_id, granted_at)
SELECT
    'm_' || ur.user_id,
    ur.role_id,
    COALESCE(ur.granted_at, UTC_TIMESTAMP(6))
FROM user_roles ur
WHERE EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.id = 'm_' || ur.user_id
);

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (13, 0);
