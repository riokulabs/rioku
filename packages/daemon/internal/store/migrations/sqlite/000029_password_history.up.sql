-- Password history table for reuse prevention (#115).
-- Stores the last N password hashes per user. SetUserPassword consults
-- this table to reject reuse; AdminResetPassword bypasses but still
-- writes an audit entry. Retention depth is configurable via
-- tenant_auth_policies.password_history_count (default 5).
CREATE TABLE password_history (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_password_history_user ON password_history (user_id, created_at DESC);

-- Add the configurable history depth to tenant_auth_policies. Default
-- 5 — the OWASP-recommended floor for reuse prevention.
ALTER TABLE tenant_auth_policies ADD COLUMN password_history_count INTEGER NOT NULL DEFAULT 5;
