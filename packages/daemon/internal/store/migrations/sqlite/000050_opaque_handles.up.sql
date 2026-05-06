-- 000050_opaque_handles.up.sql
-- Opaque-handle store: maps a short random handle (oh_...) to a SHA-256 of
-- the original PII value. The original value is never persisted.
-- Idempotency: same (tenant_id, value_hash) always returns the same handle.

CREATE TABLE IF NOT EXISTS opaque_handles (
  handle      TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  value_hash  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_opaque_handles_tenant ON opaque_handles(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_opaque_handles_tenant_value ON opaque_handles(tenant_id, value_hash);

-- Seed opaque permissions into the permission catalog.
INSERT INTO permissions (id, resource, action, description, source) VALUES
    ('opaque:read',  'opaque', 'read',  'Resolve an opaque handle back to its metadata', 'built-in'),
    ('opaque:write', 'opaque', 'write', 'Register a new opaque handle for a PII value',  'built-in')
ON CONFLICT(id) DO NOTHING;
