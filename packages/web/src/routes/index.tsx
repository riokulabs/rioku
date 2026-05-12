import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // Redirect to tenant picker; tenant resolution is wired later.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/tenants' });
  },
});
