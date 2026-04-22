/**
 * /admin/users — global cross-tenant user registry.
 *
 * spec §8.1 / Task 1d.78
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { CrossTenantUsers } from '@/features/super-admin';

export const Route = createFileRoute('/admin/users')({
  beforeLoad: requirePermissions({ required: ['admin:cross-tenant-read'] }),
  component: CrossTenantUsers,
});
