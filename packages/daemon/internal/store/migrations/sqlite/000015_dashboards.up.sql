--------------------------------------------------------------------------------
-- Dashboards: per-tenant analytics surfaces (stage-2).
--
-- A Dashboard owns a set of Widgets and a history of Versions
-- (snapshots taken on demand). The admin panel mock supports two
-- "modes" (metabase, grafana) and three "scopes" (personal, tenant,
-- shared). Scope plus owner_user_id determines visibility:
--
--   - personal: visible only to owner_user_id
--   - tenant:   visible to every member of tenant
--   - shared:   visible to every membership listed in shared_role_ids
--
-- "default" is a per-tenant flag (only one dashboard at a time);
-- "home_for_users" is a JSON array of user IDs who picked this
-- dashboard as their personal home.
--------------------------------------------------------------------------------

CREATE TABLE dashboards (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    mode            TEXT NOT NULL DEFAULT 'metabase' CHECK (mode IN ('metabase','grafana')),
    scope           TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal','tenant','shared')),
    owner_user_id   TEXT,                                                   -- nullable for tenant-scoped
    is_default      INTEGER NOT NULL DEFAULT 0,                             -- only one default per tenant (enforced in code)
    shared_role_ids TEXT NOT NULL DEFAULT '[]',                             -- JSON array
    home_for_users  TEXT NOT NULL DEFAULT '[]',                             -- JSON array of user IDs
    variables       TEXT NOT NULL DEFAULT '[]',                             -- JSON array of {name, kind, default}
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_dashboards_tenant ON dashboards (tenant_id);
CREATE INDEX idx_dashboards_owner  ON dashboards (owner_user_id);
CREATE INDEX idx_dashboards_scope  ON dashboards (scope);

--------------------------------------------------------------------------------
-- Widgets: visualization tiles inside a Dashboard.
--
-- Two layered fields cover the wizard/advanced split exposed by the
-- builder:
--   - config: the wizard state (a structured JSON object describing
--     filters, group-bys, axes — kind-specific)
--   - raw_query: when locked_advanced=1, the user has dropped to a
--     hand-written query that overrides the wizard.
-- The compiler reads raw_query if locked_advanced, else config.
--
-- Layout is stored as a single JSON object {x, y, w, h} per widget;
-- bulk reorder happens via PUT /dashboards/:id/layout which rewrites
-- every widget's position in one transaction.
--------------------------------------------------------------------------------

CREATE TABLE widgets (
    id              TEXT PRIMARY KEY,
    dashboard_id    TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,                                          -- single-stat | sparkline | time-series | stacked-bar | table | pie | service-map | log-viewer | audit-tail | top-n | <plugin>
    title           TEXT NOT NULL,
    data_source     TEXT NOT NULL DEFAULT '',                               -- e.g. "traffic.requests"
    config          TEXT NOT NULL DEFAULT '{}',                             -- wizard JSON state
    raw_query       TEXT,                                                   -- only used when locked_advanced=1
    locked_advanced INTEGER NOT NULL DEFAULT 0,
    layout          TEXT NOT NULL DEFAULT '{"x":0,"y":0,"w":4,"h":3}',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_widgets_dashboard ON widgets (dashboard_id);

--------------------------------------------------------------------------------
-- Dashboard versions: point-in-time snapshots used by the
-- "version history" page and the restore button.
--
-- snapshot_json is the JSON-serialized {dashboard, widgets} blob,
-- which round-trips through import/export too.
--------------------------------------------------------------------------------

CREATE TABLE dashboard_versions (
    id            TEXT PRIMARY KEY,
    dashboard_id  TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    version       INTEGER NOT NULL,                                         -- monotonic per dashboard
    created_by    TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    note          TEXT NOT NULL DEFAULT '',
    snapshot_json TEXT NOT NULL,                                            -- JSON blob with full dashboard + widgets
    UNIQUE (dashboard_id, version)
);

CREATE INDEX idx_dashboard_versions_dashboard ON dashboard_versions (dashboard_id);
