-- Revert Plan 12: remove parent_domain from tenants.
-- SQLite does not support DROP COLUMN in older versions; use table recreation.
CREATE TABLE tenants_backup AS SELECT id, slug, name, plan, url_mode, accent, logo_url, default_dashboard_id, created_at, updated_at FROM tenants;
DROP TABLE tenants;
ALTER TABLE tenants_backup RENAME TO tenants;
