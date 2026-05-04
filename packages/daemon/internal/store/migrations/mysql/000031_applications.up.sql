-- Sprint 4 Phase 1a (#164): Applications table.
CREATE TABLE applications (
    id            VARCHAR(255) PRIMARY KEY,
    tenant_id     VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    description   TEXT NOT NULL,
    owner_user_id VARCHAR(255),
    status        VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_applications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_applications_owner  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_applications_tenant ON applications (tenant_id);
CREATE INDEX idx_applications_owner  ON applications (owner_user_id);
CREATE INDEX idx_applications_status ON applications (status);
CREATE UNIQUE INDEX idx_applications_tenant_name ON applications (tenant_id, name);
