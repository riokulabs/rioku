CREATE TABLE services_backup AS SELECT id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds, passive_health_check, retry_policy FROM services;
DROP TABLE services;
ALTER TABLE services_backup RENAME TO services;
DELETE FROM schema_versions WHERE version = 11;
