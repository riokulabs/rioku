-- 000053_cluster_manage_permission.down.sql (mysql)
DELETE FROM permissions WHERE id = 'cluster:manage' AND source = 'built-in';
