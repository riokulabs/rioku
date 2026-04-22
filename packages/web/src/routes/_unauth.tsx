import { createFileRoute, Outlet } from '@tanstack/react-router';
import { UnauthLayout } from '@/layout/unauth-layout';

export const Route = createFileRoute('/_unauth')({
  component: () => (
    <UnauthLayout>
      <Outlet />
    </UnauthLayout>
  ),
});
