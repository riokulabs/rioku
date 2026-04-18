import { createFileRoute } from '@tanstack/react-router';
import { Title } from '@mantine/core';

export const Route = createFileRoute('/_unauth/reset-password/$token')({
  component: () => <Title order={2}>Reset Password (Plan 1e)</Title>,
});
