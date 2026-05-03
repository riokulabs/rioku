-- Sprint 4 Phase 1a (#164): Applications table.
--
-- An Application is a consumer-facing identity that owns Subscriptions.
-- Multiple subscriptions per application (one per Plan + API combo);
-- the same human user can own multiple applications.
--
-- v1 status values: active | paused | closed. closed is terminal —
-- subscriptions cascade to closed when their parent application closes.
CREATE TABLE applications (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_applications_tenant ON applications (tenant_id);
CREATE INDEX idx_applications_owner  ON applications (owner_user_id);
CREATE INDEX idx_applications_status ON applications (status);
CREATE UNIQUE INDEX idx_applications_tenant_name ON applications (tenant_id, name);
