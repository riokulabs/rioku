import { createFileRoute } from '@tanstack/react-router';
import { Title } from '@mantine/core';

export const Route = createFileRoute('/_unauth/bootstrap')({
  component: () => <Title order={2}>Bootstrap (Plan 1e)</Title>,
});
