import { createFileRoute } from '@tanstack/react-router';
import { Title } from '@mantine/core';

export const Route = createFileRoute('/t/$tenant/dashboard')({
  component: () => <Title order={2}>Dashboard (Plan 4 populates)</Title>,
});
