-- 000004_totp_backup.up.sql (postgres)
CREATE TABLE totp_backup_codes (
    id        TEXT NOT NULL PRIMARY KEY,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at   TIMESTAMPTZ
);
CREATE INDEX idx_totp_backup_user ON totp_backup_codes(user_id);

INSERT INTO schema_versions (version, dirty) VALUES (4, FALSE) ON CONFLICT DO NOTHING;
