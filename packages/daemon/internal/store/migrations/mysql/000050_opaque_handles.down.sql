-- 000050_opaque_handles.down.sql
DELETE FROM permissions WHERE id IN ('opaque:read', 'opaque:write');
DROP INDEX idx_opaque_handles_tenant_value ON opaque_handles;
DROP INDEX idx_opaque_handles_tenant ON opaque_handles;
DROP TABLE IF EXISTS opaque_handles;
