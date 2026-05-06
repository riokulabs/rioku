-- 000050_opaque_handles.up.sql
-- Opaque-handle store: maps a short random handle (oh_...) to a SHA-256 of
-- the original PII value. The original value is never persisted.
-- Idempotency: same (tenant_id, value_hash) always returns the same handle.

CREATE TABLE IF NOT EXISTS opaque_handles (
  handle      VARCHAR(64) PRIMARY KEY,
  tenant_id   VARCHAR(64) NOT NULL,
  value_hash  VARCHAR(64) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NULL
);
CREATE INDEX idx_opaque_handles_tenant ON opaque_handles(tenant_id);
CREATE UNIQUE INDEX idx_opaque_handles_tenant_value ON opaque_handles(tenant_id, value_hash);

-- Seed opaque permissions into the permission catalog.
INSERT IGNORE INTO permissions (id, resource, action, description, source) VALUES
    ('opaque:read',  'opaque', 'read',  'Resolve an opaque handle back to its metadata', 'built-in'),
    ('opaque:write', 'opaque', 'write', 'Register a new opaque handle for a PII value',  'built-in');
