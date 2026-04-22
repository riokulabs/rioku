/**
 * Sessions page — /t/$tenant/security/sessions
 *
 * Shows the current user's sessions. Includes a link to Authentication settings.
 * Permission guard: requires session:read.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Text, Anchor } from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';
import { SessionList } from '@/features/security/sessions';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';

function SessionsPage() {
  const { tenant } = Route.useParams();
  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';

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

      <SessionList tenantId={tenantId} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/sessions')({
  beforeLoad: requirePermissions({ required: ['session:read'] }),
  component: SessionsPage,
});
