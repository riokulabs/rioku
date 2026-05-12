/**
 * /admin/tenants — tenant inventory for super-admin.
 *
 * Requires: admin:cross-tenant-write (tenant creation/deletion is a write operation).
 * Wrapped by AdminLayout via parent /admin route.
 *
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { TenantInventory } from '@/features/super-admin';

export const Route = createFileRoute('/admin/tenants')({
  beforeLoad: requirePermissions({
    required: ['admin:cross-tenant-write'],
    requireAny: false,
  }),
  component: TenantInventory,
});
