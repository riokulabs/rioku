import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AdminLayout } from '@/layout/admin-layout';
import { requirePermissions } from '@/hooks/use-before-load';

export const Route = createFileRoute('/admin')({
  beforeLoad: requirePermissions({ required: ['admin:cross-tenant-read'] }),
  component: () => (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  ),
});
