import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AdminLayout } from '@/layout/admin-layout';

export const Route = createFileRoute('/admin')({
  component: () => (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  ),
});
