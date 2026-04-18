import { createFileRoute } from '@tanstack/react-router';
import { Title } from '@mantine/core';

export const Route = createFileRoute('/_unauth/invite/$token')({
  component: () => <Title order={2}>Accept Invite (Plan 1e)</Title>,
});
