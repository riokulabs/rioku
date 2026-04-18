import { createFileRoute } from '@tanstack/react-router';
import { Title } from '@mantine/core';

export const Route = createFileRoute('/_unauth/login')({
  component: () => <Title order={2}>Login (Plan 1e)</Title>,
});
