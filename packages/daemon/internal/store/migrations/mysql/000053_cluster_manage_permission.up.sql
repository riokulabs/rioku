-- 000053_cluster_manage_permission.up.sql (mysql)
-- Plan 10 (stage 2): the cluster routes (cluster_routes.go) require `cluster:manage`
-- for node-removal and force-sync, but the v2 catalog seeded by 000049 omitted it.
-- Add the missing entry so RBAC can grant it and the admin panel catalog surfaces it.
INSERT IGNORE INTO permissions (id, resource, action, description, source) VALUES
    ('cluster:manage', 'cluster', 'manage', 'Manage cluster membership (remove nodes, force config sync)', 'built-in');
