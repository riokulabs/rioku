-- 000053_cluster_manage_permission.down.sql
DELETE FROM permissions WHERE id = 'cluster:manage' AND source = 'built-in';
