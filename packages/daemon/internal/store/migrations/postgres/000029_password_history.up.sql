-- Password history table for reuse prevention (#115).
CREATE TABLE password_history (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_password_history_user ON password_history (user_id, created_at DESC);

ALTER TABLE tenant_auth_policies ADD COLUMN password_history_count INTEGER NOT NULL DEFAULT 5;
