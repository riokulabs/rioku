/**
 * Sessions page — /t/$tenant/security/sessions
 *
 * Shows the current user's sessions. Includes a link to Authentication settings.
 * Permission guard: requires session:read.
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Text, Anchor, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconShieldLock } from '@tabler/icons-react';
import { SessionList, SessionDetail } from '@/features/security/sessions';
import type { SessionWithMeta } from '@/features/security/sessions';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';

function SessionsPage() {
  const { tenant } = Route.useParams();
  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [selected, setSelected] = useState<SessionWithMeta | null>(null);

  function handleRowClick(session: SessionWithMeta) {
    setSelected(session);
    openDrawer();
  }

  const drawerTitle = selected ? `Session — ${selected.device}` : 'Session detail';

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

      <SessionList tenantId={tenantId} onSelect={handleRowClick} />

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="min(480px, 95vw)"
        padding="md"
      >
        {selected && <SessionDetail session={selected} onClose={closeDrawer} />}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/sessions')({
  beforeLoad: requirePermissions({ required: ['session:read'] }),
  component: SessionsPage,
});
