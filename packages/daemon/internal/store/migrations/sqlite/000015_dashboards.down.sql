DROP INDEX IF EXISTS idx_dashboard_versions_dashboard;
DROP TABLE IF EXISTS dashboard_versions;

DROP INDEX IF EXISTS idx_widgets_dashboard;
DROP TABLE IF EXISTS widgets;

DROP INDEX IF EXISTS idx_dashboards_scope;
DROP INDEX IF EXISTS idx_dashboards_owner;
DROP INDEX IF EXISTS idx_dashboards_tenant;
DROP TABLE IF EXISTS dashboards;

DELETE FROM schema_versions WHERE version = 15;
