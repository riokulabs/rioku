import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppLayout } from '@/layout/app-layout';

export const Route = createFileRoute('/t/$tenant')({
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});
