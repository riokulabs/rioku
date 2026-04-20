/**
 * <ChannelList> — DataTable of notification channels for a tenant.
 *
 * Columns: kind badge (with per-kind icon), name, enabled Switch,
 * last-24h delivery count (derived from delivery log), and a row-action menu
 * (Edit / Test / Delete). Row click → onSelect (opens detail drawer).
 */
import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  ActionIcon,
  Badge,
  Menu,
  Switch,
  Text,
} from '@mantine/core';
import type { Icon } from '@tabler/icons-react';
import {
  IconBell,
  IconBrandSlack,
  IconBrandTeams,
  IconDeviceMobile,
  IconDots,
  IconMail,
  IconPencil,
  IconTrash,
  IconUrgent,
  IconWebhook,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useMockStore } from '@/api/mock-store';
import { useChannelList, updateChannel } from '../api';
import type { ChannelFilter, NotificationChannel } from '../types';

const KIND_COLORS: Record<NotificationChannel['kind'], string> = {
  email: 'blue',
  slack: 'grape',
  webhook: 'cyan',
  pagerduty: 'red',
  teams: 'indigo',
  sms: 'teal',
};

const KIND_ICONS: Record<NotificationChannel['kind'], Icon> = {
  email: IconMail,
  slack: IconBrandSlack,
  webhook: IconWebhook,
  pagerduty: IconUrgent,
  teams: IconBrandTeams,
  sms: IconDeviceMobile,
};

interface ChannelListProps {
  tenantId: string;
  filter: ChannelFilter;
  onSelect: (c: NotificationChannel) => void;
  onEdit: (c: NotificationChannel) => void;
  onTest: (c: NotificationChannel) => void;
  onDelete: (c: NotificationChannel) => void;
}

export function ChannelList({
  tenantId,
  filter,
  onSelect,
  onEdit,
  onTest,
  onDelete,
}: ChannelListProps) {
  const channels = useChannelList(tenantId, filter);
  const deliveryLog = useMockStore((s) => s.notificationDeliveryLog);
  const canWrite = usePermission('notification-channel:write');
  const canTest = usePermission('notification-channel:test');

  // Derive "deliveries in the last 24h" counts outside the selector so the
  // store selector stays referentially stable. The 24h cutoff is captured once
  // at first render (pure from React's POV) — stage 1 mock data doesn't shift
  // under our feet.
  const [cutoffAt] = useState(() =>
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );
  const last24hCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of Object.values(deliveryLog)) {
      if (entry.last_attempted_at < cutoffAt) continue;
      counts[entry.channel_id] = (counts[entry.channel_id] ?? 0) + 1;
    }
    return counts;
  }, [deliveryLog, cutoffAt]);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleToggle(c: NotificationChannel, next: boolean) {
    setTogglingId(c.id);
    try {
      await updateChannel(c.id, { enabled: next });
      notify.success(
        next ? 'Channel enabled' : 'Channel disabled',
        `${c.name} is now ${next ? 'active' : 'inactive'}.`,
      );
    } catch {
      notify.error('Failed to toggle channel', 'Please try again.');
    } finally {
      setTogglingId(null);
    }
  }

  const columns = useMemo<ColumnDef<NotificationChannel>[]>(
    () => [
      {
        id: 'kind',
        header: 'Kind',
        size: 140,
        accessorFn: (row) => row.kind,
        cell: ({ row }) => {
          const c = row.original;
          const KindIcon = KIND_ICONS[c.kind];
          return (
            <Badge
              size="sm"
              variant="light"
              color={KIND_COLORS[c.kind]}
              leftSection={<KindIcon size={12} />}
            >
              {c.kind}
            </Badge>
          );
        },
      },
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <Text size="sm" fw={500}>
            {row.original.name}
          </Text>
        ),
      },
      {
        id: 'enabled',
        header: 'Enabled',
        size: 100,
        accessorFn: (row) => row.enabled,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <Switch
              checked={c.enabled}
              disabled={togglingId === c.id || !canWrite}
              aria-label={c.enabled ? `Disable ${c.name}` : `Enable ${c.name}`}
              onChange={(e) => {
                e.stopPropagation();
                void handleToggle(c, e.currentTarget.checked);
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            />
          );
        },
      },
      {
        id: 'deliveries_24h',
        header: '24h deliveries',
        size: 140,
        accessorFn: (row) => last24hCounts[row.id] ?? 0,
        cell: ({ getValue }) => {
          const n = getValue<number>();
          return (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {String(n)}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <Menu shadow="md" width={160} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${c.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconPencil size={14} />}
                  disabled={!canWrite}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(c);
                  }}
                >
                  Edit
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconBell size={14} />}
                  disabled={!canTest}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTest(c);
                  }}
                >
                  Send test
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  disabled={!canWrite}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c);
                  }}
                >
                  Delete…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          );
        },
      },
    ],
    [last24hCounts, togglingId, canWrite, canTest, onEdit, onTest, onDelete],
  );

  return (
    <DataTable
      data={channels}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="notif-channels"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconBell}
          title="No channels"
          description="Create a notification channel to start routing events."
        />
      }
      caption="Notification channels"
    />
  );
}
