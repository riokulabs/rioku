import { createFileRoute } from '@tanstack/react-router';
import { Title } from '@mantine/core';

export const Route = createFileRoute('/_unauth/totp-recovery')({
  component: () => <Title order={2}>TOTP Recovery (Plan 1e)</Title>,
});
