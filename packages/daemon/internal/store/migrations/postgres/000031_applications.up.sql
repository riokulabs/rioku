-- Sprint 4 Phase 1a (#164): Applications table.
CREATE TABLE applications (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_applications_tenant ON applications (tenant_id);
CREATE INDEX idx_applications_owner  ON applications (owner_user_id);
CREATE INDEX idx_applications_status ON applications (status);
CREATE UNIQUE INDEX idx_applications_tenant_name ON applications (tenant_id, name);
