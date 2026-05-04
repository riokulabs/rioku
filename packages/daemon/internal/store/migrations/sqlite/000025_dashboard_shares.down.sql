-- 000025_dashboard_shares.down.sql

DROP INDEX IF EXISTS idx_dashboard_shares_unique;
DROP INDEX IF EXISTS idx_dashboard_shares_dashboard;
DROP INDEX IF EXISTS idx_dashboard_shares_tenant;
DROP TABLE IF EXISTS dashboard_shares;
