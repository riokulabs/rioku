/**
 * Sessions page — /t/$tenant/security/sessions
 *
 * Sessions render inline. No drawer, no detail page. The list view is the
 * canonical surface; rows expose Revoke directly.
 *
 * Permission guard: requires `session:read`.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Text, Anchor } from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';
import { SessionList } from '@/features/security/sessions';
import { requirePermissions } from '@/hooks/use-before-load';

function SessionsPage() {
  const { tenant } = Route.useParams();

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <IconShieldLock size={20} />
          <Title order={2}>Sessions</Title>
        </Group>
        <Anchor href={`/t/${tenant}/settings`} size="sm">
          Settings → Authentication → Session timeouts
        </Anchor>
      </Group>

      <Text size="sm" c="dimmed">
        Active sessions for your account. Revoke any session you don&apos;t recognise.
      </Text>

      <SessionList tenant={tenant} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/sessions')({
  beforeLoad: requirePermissions({ required: ['session:read'] }),
  component: SessionsPage,
});
