/**
 * Bootstrap first-run page.
 *
 * Only shown when no users exist in the mock store.
 * If users exist, redirect to /login.
 *
 * Task 1e.90
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Title, Stack, Button, Text, Alert } from '@mantine/core';
import { useMockStore } from '@/api/mock-store';
import { BootstrapForm } from '@/features/auth/components/bootstrap-form';
import { seedStore } from '@/api/mock-seed';
import { IconAlertTriangle } from '@tabler/icons-react';

export const Route = createFileRoute('/_unauth/bootstrap')({
  beforeLoad() {
    // Redirect to login if users already exist.
    const state = useMockStore.getState();
    if (Object.keys(state.users).length > 0) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/login' });
    }
  },
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

      {/* Dev-only helper: re-seed button so testers can return to seeded state */}
      {import.meta.env.DEV && <DevReseedHelper />}

      <BootstrapForm />
    </Stack>
  );
}

function DevReseedHelper() {
  function handleReseed() {
    useMockStore.getState().reset();
    seedStore(useMockStore);
    window.location.href = '/login';
  }

  return (
    <Alert
      icon={<IconAlertTriangle size={16} />}
      color="orange"
      variant="light"
      data-testid="dev-reseed-alert"
    >
      <Stack gap="xs">
        <Text size="xs" fw={600}>
          Dev mode — currently no users in store
        </Text>
        <Text size="xs">
          To return to the seeded demo data, click below.
        </Text>
        <Button
          size="xs"
          variant="outline"
          color="orange"
          onClick={handleReseed}
          data-testid="dev-reseed-button"
        >
          Re-seed demo data and go to login
        </Button>
      </Stack>
    </Alert>
  );
}
