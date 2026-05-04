--------------------------------------------------------------------------------
-- Sites: per-tenant gateway entries (domain + TLS mode + redirect rules).
--
-- The admin panel renders one row per "Site" — a customer-facing domain
-- the gateway terminates TLS for. A Site optionally points at a Service
-- (the underlying upstream pool) and carries presentation-level config:
-- HTTP basic auth, a rate-limit preset, redirect rules.
--
-- The configuration that lives on the underlying Caddy server block
-- (TLS automation, automatic_https) is computed from these rows during
-- compile, but the Sites table itself is the source of truth in the
-- admin's mental model.
--------------------------------------------------------------------------------

CREATE TABLE sites (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    domain             TEXT NOT NULL,
    tls_mode           TEXT NOT NULL DEFAULT 'auto' CHECK (tls_mode IN ('auto','manual','off')),
    enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    upstream_service_id TEXT,                                          -- nullable; not a hard FK so a service can be deleted without orphaning the site
    basic_auth_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    basic_auth_realm   TEXT,
    rate_limit_preset  TEXT NOT NULL DEFAULT 'none' CHECK (rate_limit_preset IN ('none','lenient','standard','strict')),
    redirect_rules     TEXT NOT NULL DEFAULT '[]',                     -- JSON array of {match, target, code}
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, domain)
);

CREATE INDEX idx_sites_tenant ON sites (tenant_id);
CREATE INDEX idx_sites_domain ON sites (domain);

--------------------------------------------------------------------------------
-- Middlewares: per-tenant reusable handler-stack components.
--
-- A Middleware is a named, configured handler (rate-limit, auth,
-- transform, cors, cache, logging, custom) that can be attached to one
-- or more routes. The admin panel exposes the catalog and lets users
-- attach via Route configuration; the existing access_policies table
-- handles the authz subset, while this table covers the rest.
--
-- order_hint is a soft sort key used when the admin renders the
-- catalog; route-level ordering is per-route and lives in the route's
-- middleware_ids JSON column (handled separately).
--------------------------------------------------------------------------------

CREATE TABLE middlewares (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('rate-limit','auth','transform','cors','cache','logging','custom')),
    config      TEXT NOT NULL DEFAULT '{}',                            -- JSON config blob, kind-specific shape
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    order_hint  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_middlewares_tenant ON middlewares (tenant_id);
CREATE INDEX idx_middlewares_kind   ON middlewares (kind);

INSERT INTO schema_versions (version, dirty) VALUES (14, FALSE)
    ON CONFLICT (version) DO NOTHING;
