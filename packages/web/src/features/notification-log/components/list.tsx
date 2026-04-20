/**
 * <DeliveryLogList> — read-only DataTable of notification delivery attempts.
 *
 * Columns: last-attempted (relative), notification title preview (joined from
 * the inbox store by notification_id), channel name (joined), status chip,
 * attempts, first_attempted_at.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  ActionIcon,
  Badge,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconEye, IconInbox } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useMockStore } from '@/api/mock-store';
import type { NotificationDeliveryLogEntry } from '@/api/resources/types';

dayjs.extend(relativeTime);

const STATUS_COLOR: Record<NotificationDeliveryLogEntry['status'], string> = {
  delivered: 'green',
  retrying: 'yellow',
  failed: 'red',
  pending: 'gray',
};

interface DeliveryLogListProps {
  rows: NotificationDeliveryLogEntry[];
  onSelect: (entry: NotificationDeliveryLogEntry) => void;
}

export function DeliveryLogList({ rows, onSelect }: DeliveryLogListProps) {
  const notifications = useMockStore((s) => s.notifications);
  const channels = useMockStore((s) => s.notificationChannels);

  const columns = useMemo<ColumnDef<NotificationDeliveryLogEntry>[]>(
    () => [
      {
        id: 'last_attempted_at',
        header: 'Last attempt',
        size: 140,
        accessorFn: (row) => row.last_attempted_at,
        cell: ({ row }) => {
          const e = row.original;
          const absolute = dayjs(e.last_attempted_at).format('YYYY-MM-DD HH:mm:ss');
          return (
            <Tooltip label={absolute} withArrow>
              <Text size="xs" ff="monospace">
                {dayjs(e.last_attempted_at).fromNow()}
              </Text>
            </Tooltip>
          );
        },
      },
      {
        id: 'notification',
        header: 'Notification',
        accessorFn: (row) => {
          const n = notifications[row.notification_id];
          return n?.title ?? row.notification_id;
        },
        cell: ({ row }) => {
          const e = row.original;
          const n = notifications[e.notification_id];
          if (!n) {
            return (
              <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
                {e.notification_id}
              </Text>
            );
          }
          return (
            <Text size="sm" lineClamp={1} title={n.title}>
              {n.title}
            </Text>
          );
        },
      },
      {
        id: 'channel',
        header: 'Channel',
        size: 200,
        accessorFn: (row) => channels[row.channel_id]?.name ?? row.channel_id,
        cell: ({ row }) => {
          const e = row.original;
          const c = channels[e.channel_id];
          if (!c) {
            return (
              <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
                {e.channel_id}
              </Text>
            );
          }
          return (
            <Text size="xs">
              {c.name}{' '}
              <Text component="span" c="var(--mantine-color-gray-7)">
                — {c.kind}
              </Text>
            </Text>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        size: 110,
        accessorFn: (row) => row.status,
        cell: ({ getValue }) => {
          const v = getValue<NotificationDeliveryLogEntry['status']>();
          return (
            <Badge size="xs" variant="light" color={STATUS_COLOR[v]}>
              {v}
            </Badge>
          );
        },
      },
      {
        id: 'attempts',
        header: 'Attempts',
        size: 100,
        accessorFn: (row) => row.attempts,
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace">
            {String(getValue<number>())}
          </Text>
        ),
      },
      {
        id: 'first_attempted_at',
        header: 'First attempt',
        size: 140,
        accessorFn: (row) => row.first_attempted_at,
        cell: ({ row }) => {
          const e = row.original;
          const absolute = dayjs(e.first_attempted_at).format('YYYY-MM-DD HH:mm:ss');
          return (
            <Tooltip label={absolute} withArrow>
              <Text size="xs" ff="monospace">
                {dayjs(e.first_attempted_at).fromNow()}
              </Text>
            </Tooltip>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 50,
        enableSorting: false,
        cell: ({ row }) => (
          <ActionIcon
            size="sm"
            variant="subtle"
            aria-label="View delivery details"
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect(row.original);
            }}
            data-testid={`delivery-row-view-${row.original.id}`}
          >
            <IconEye size={14} />
          </ActionIcon>
        ),
      },
    ],
    [notifications, channels, onSelect],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      sorting
      pagination={{ pageSize: 50 }}
      urlSyncKey="delivery-log"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconInbox}
          title="No deliveries"
          description="No delivery matches the current filters."
        />
      }
      caption="Notification delivery log"
    />
  );
}
