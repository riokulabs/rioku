DROP INDEX idx_password_history_user ON password_history;
ALTER TABLE password_history DROP FOREIGN KEY fk_password_history_user;
DROP TABLE IF EXISTS password_history;
ALTER TABLE tenant_auth_policies DROP COLUMN password_history_count;
