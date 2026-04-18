import { createFileRoute } from '@tanstack/react-router';
import { Title } from '@mantine/core';

export const Route = createFileRoute('/_unauth/forgot-password')({
  component: () => <Title order={2}>Forgot Password (Plan 1e)</Title>,
});
