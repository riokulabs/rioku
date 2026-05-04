-- 000025_dashboard_shares.up.sql
--
-- Dashboard sharing links (stage-2 admin completion chunk 8).
-- Each row authorises one role to view a dashboard, optionally with
-- an expiry. Multiple rows = multiple role grants.

CREATE TABLE dashboard_shares (
    id            TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL DEFAULT 'tenant_default',
    dashboard_id  TEXT NOT NULL,
    role_id       TEXT NOT NULL,
    created_by    TEXT,
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE INDEX idx_dashboard_shares_tenant ON dashboard_shares(tenant_id);
CREATE INDEX idx_dashboard_shares_dashboard ON dashboard_shares(dashboard_id);
CREATE UNIQUE INDEX idx_dashboard_shares_unique
  ON dashboard_shares(dashboard_id, role_id);

INSERT INTO schema_versions (version, dirty) VALUES (25, FALSE)
    ON CONFLICT (version) DO NOTHING;
