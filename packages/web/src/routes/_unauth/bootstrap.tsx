/**
 * Bootstrap first-run page.
 *
 * Reachable when the daemon's `/auth/bootstrap-status` returns
 * `{required: true}`. The root `beforeLoad` redirects everyone here when
 * bootstrap is required, and kicks anyone landing here to `/login` when it
 * is not.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Title, Stack, Text } from '@mantine/core';
import { BootstrapForm } from '@/features/auth/components/bootstrap-form';

export const Route = createFileRoute('/_unauth/bootstrap')({
  component: BootstrapPage,
});

function BootstrapPage() {
  return (
    <Stack gap="lg">
      <Title order={2} ta="center">
        Welcome to Rioku
      </Title>
      <Text size="sm" c="dimmed" ta="center">
        Create your organization and root account to get started.
      </Text>
      <BootstrapForm />
    </Stack>
  );
}
