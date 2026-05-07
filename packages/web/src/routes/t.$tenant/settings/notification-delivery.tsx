/**
 * Notification delivery log — /t/$tenant/settings/notification-delivery
 *
 * Read-only DataTable of delivery attempts with URL-synced filters and a
 * small detail drawer.
 *
 * Permission guard: notification-log:read.
 */
import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Anchor, Drawer, Group, Stack, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  DeliveryLogDetail,
  DeliveryLogFilterBar,
  DeliveryLogList,
  useDeliveryLogList,
} from '@/features/notification-log';
import type { DeliveryLogFilter, NotificationDeliveryLogEntry } from '@/features/notification-log';

interface SearchParams {
  search: string;
  statuses: NotificationDeliveryLogEntry['status'][];
  channel_ids: string[];
  date_from: string | null;
  date_to: string | null;
}

const STATUS_SET: ReadonlySet<NotificationDeliveryLogEntry['status']> = new Set([
  'delivered',
  'retrying',
  'failed',
  'pending',
]);

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

function narrowStatuses(values: string[]): NotificationDeliveryLogEntry['status'][] {
  return values.filter((v): v is NotificationDeliveryLogEntry['status'] =>
    STATUS_SET.has(v as NotificationDeliveryLogEntry['status']),
  );
}

function NotificationDeliveryPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantId = tenant ?? '';
  const tenantSlug = tenant ?? '';

  const filter: DeliveryLogFilter = {
    statuses: search.statuses,
    channel_ids: search.channel_ids,
    date_from: search.date_from,
    date_to: search.date_to,
    search: search.search,
  };

  function setFilter(next: DeliveryLogFilter) {
    void navigate({
      to: '/t/$tenant/settings/notification-delivery',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        statuses: next.statuses.join(','),
        channel_ids: next.channel_ids.join(','),
        date_from: next.date_from ?? '',
        date_to: next.date_to ?? '',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const rows = useDeliveryLogList(tenantId, filter);

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [selected, setSelected] = useState<NotificationDeliveryLogEntry | null>(null);

  function handleSelect(entry: NotificationDeliveryLogEntry) {
    setSelected(entry);
    openDrawer();
  }

  return (
    <Stack gap="md" p="md" data-testid="notification-delivery-page">
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

      <Title order={2}>Delivery log</Title>

      <DeliveryLogFilterBar tenantId={tenantId} filter={filter} onChange={setFilter} />

      <DeliveryLogList rows={rows} onSelect={handleSelect} />

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title="Delivery details"
        position="right"
        size="min(400px, 95vw)"
        padding="md"
      >
        {selected && (
          <DeliveryLogDetail entryId={selected.id} tenantSlug={tenantSlug} onClose={closeDrawer} />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/notification-delivery')({
  beforeLoad: requirePermissions({ required: ['notification-log:read'] }),
  component: NotificationDeliveryPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    statuses: narrowStatuses(parseCsv(s.statuses)),
    channel_ids: parseCsv(s.channel_ids),
    date_from: typeof s.date_from === 'string' && s.date_from.length > 0 ? s.date_from : null,
    date_to: typeof s.date_to === 'string' && s.date_to.length > 0 ? s.date_to : null,
  }),
});
