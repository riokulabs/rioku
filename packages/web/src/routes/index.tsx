import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // Stage 1: redirect to tenant picker; real logic in Plan 1d
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/tenants' });
  },
});
