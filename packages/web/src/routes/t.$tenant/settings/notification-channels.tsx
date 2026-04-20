/**
 * Notification channels — /t/$tenant/settings/notification-channels
 *
 * List + filter bar + drawer (detail / create / edit). URL-synced search +
 * kind + enabled filter.
 *
 * Permission guard: notification-channel:read.
 */
import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  Anchor,
  Button,
  Drawer,
  Group,
  Stack,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowLeft, IconPlus } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  CHANNEL_KINDS,
  ChannelDetail,
  ChannelFilterBar,
  ChannelForm,
  ChannelList,
  deleteChannel,
  testChannel,
} from '@/features/notification-channels';
import type {
  ChannelFilter,
  NotificationChannel,
} from '@/features/notification-channels';

type DrawerMode = 'detail' | 'create' | 'edit';

interface SearchParams {
  search: string;
  kinds: NotificationChannel['kind'][];
  enabled?: 'true' | 'false';
}

function parseCsv(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof v !== 'string') return [];
  if (v.length === 0) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const KIND_SET: ReadonlySet<NotificationChannel['kind']> = new Set(CHANNEL_KINDS);

function narrowKinds(values: string[]): NotificationChannel['kind'][] {
  return values.filter((v): v is NotificationChannel['kind'] =>
    KIND_SET.has(v as NotificationChannel['kind']),
  );
}

function NotificationChannelsPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const canWrite = usePermission('notification-channel:write');

  const filter: ChannelFilter = {
    search: search.search,
    kinds: search.kinds,
    enabled:
      search.enabled === 'true'
        ? true
        : search.enabled === 'false'
          ? false
          : undefined,
  };

  function setFilter(next: ChannelFilter) {
    void navigate({
      to: '/t/$tenant/settings/notification-channels',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        kinds: next.kinds.join(','),
        enabled:
          next.enabled === true ? 'true' : next.enabled === false ? 'false' : '',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selected, setSelected] = useState<NotificationChannel | null>(null);

  function handleRowClick(c: NotificationChannel) {
    setSelected(c);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelected(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(c: NotificationChannel) {
    setSelected(c);
    setDrawerMode('edit');
    openDrawer();
  }

  async function handleTestFromList(c: NotificationChannel) {
    try {
      const result = await testChannel(c.id);
      if (result.ok) {
        notify.success(
          'Test sent',
          `${c.name} responded in ${String(result.latency_ms)}ms.`,
        );
      } else {
        notify.error('Test failed', result.error ?? 'Unknown error');
      }
    } catch {
      notify.error('Test failed', 'Please try again.');
    }
  }

  async function handleDeleteFromList(c: NotificationChannel) {
    try {
      await deleteChannel(c.id);
      notify.success('Channel deleted', `${c.name} was removed.`);
    } catch {
      notify.error('Failed to delete channel', 'Please try again.');
    }
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create channel'
      : drawerMode === 'edit'
        ? `Edit — ${selected?.name ?? ''}`
        : (selected?.name ?? 'Channel detail');

  return (
    <Stack gap="md" p="md" data-testid="notification-channels-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
          component={Link as any}
          to="/t/$tenant/settings/notifications"
          params={{ tenant: tenantSlug }}
          size="sm"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to notifications</span>
          </Group>
        </Anchor>
      </Group>

      <Group justify="space-between" align="center">
        <Title order={2}>Notification channels</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={handleCreate}
          disabled={!canWrite}
        >
          New channel
        </Button>
      </Group>

      <ChannelFilterBar filter={filter} onChange={setFilter} />

      <ChannelList
        tenantId={tenantId}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onTest={(c) => void handleTestFromList(c)}
        onDelete={(c) => void handleDeleteFromList(c)}
      />

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="xl"
        padding="md"
      >
        {drawerMode === 'detail' && selected && (
          <ChannelDetail
            channelId={selected.id}
            onEdit={() => {
              setDrawerMode('edit');
            }}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <ChannelForm
            mode="create"
            tenantId={tenantId}
            onSuccess={(c) => {
              setSelected(c);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selected && (
          <ChannelForm
            mode="edit"
            tenantId={tenantId}
            initialValues={selected}
            onSuccess={(c) => {
              setSelected(c);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/notification-channels')({
  beforeLoad: requirePermissions({ required: ['notification-channel:read'] }),
  component: NotificationChannelsPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    kinds: narrowKinds(parseCsv(s.kinds)),
    ...(s.enabled === 'true'
      ? { enabled: 'true' as const }
      : s.enabled === 'false'
        ? { enabled: 'false' as const }
        : {}),
  }),
});
