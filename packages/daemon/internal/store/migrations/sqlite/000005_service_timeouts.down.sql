-- SQLite does not support DROP COLUMN before 3.35.0; recreate table.
CREATE TABLE services_backup AS SELECT id, name, lb_policy, health_check, labels, created_at, updated_at FROM services;
DROP TABLE services;
ALTER TABLE services_backup RENAME TO services;
DELETE FROM schema_versions WHERE version = 5;
