-- 000050_opaque_handles.down.sql
DELETE FROM permissions WHERE id IN ('opaque:read', 'opaque:write');
DROP INDEX IF EXISTS idx_opaque_handles_tenant_value;
DROP INDEX IF EXISTS idx_opaque_handles_tenant;
DROP TABLE IF EXISTS opaque_handles;
