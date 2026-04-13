-- 000006_user_deleted_status.up.sql
-- Add 'deleted' to the user status CHECK constraint.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'locked', 'deleted'));

INSERT INTO schema_versions (version, dirty) VALUES (6, false)
    ON CONFLICT (version) DO NOTHING;
