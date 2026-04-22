/**
 * <NotificationList> — DataTable of notifications for the full inbox page.
 *
 * Columns:
 *   - severity icon (colored)
 *   - category chip (plugin: collapsed to "Plugin · <slug>")
 *   - title + body (body truncated to 1 line)
 *   - relative timestamp (tooltip full ISO)
 *   - actions (view details / mark read / archive)
 *
 * Row click → onSelect(item) → parent opens <NotificationDetail> drawer.
 *
 * `rows` is pre-filtered + sorted by the caller — sorting is the caller's
 * job so the same list can be shared between the paged + infinite views
 * without re-sorting.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from '@mantine/core';
import {
  IconAlertTriangle,
  IconArchive,
  IconBell,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconEye,
  IconInfoCircle,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { usePermission } from '@/hooks/use-permission';
import { archive, markRead } from '../api';
import { notify } from '@/hooks/use-notify';
import type { ID, NotificationItem } from '../types';

dayjs.extend(relativeTime);

const SEVERITY_ICON: Record<NotificationItem['severity'], typeof IconInfoCircle> = {
  info: IconInfoCircle,
  warn: IconAlertTriangle,
  error: IconCircleX,
  success: IconCircleCheck,
};

const SEVERITY_COLOR: Record<NotificationItem['severity'], string> = {
  info: 'blue',
  warn: 'orange',
  error: 'red',
  success: 'green',
};

function formatCategoryLabel(category: string): string {
  if (category.startsWith('plugin:')) {
    return `Plugin · ${category.slice('plugin:'.length)}`;
  }
  if (category.length === 0) return 'Other';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export interface NotificationListProps {
  rows: NotificationItem[];
  onSelect: (item: NotificationItem) => void;
}

export function NotificationList({ rows, onSelect }: NotificationListProps) {
  const canManageOwn = usePermission('notification:manage-own');

  async function doMarkRead(id: ID) {
    try {
      await markRead(id);
    } catch {
      notify.error('Mark read failed', 'Please try again.');
    }
  }

  async function doArchive(id: ID) {
    try {
      await archive(id);
      notify.success('Archived', 'Notification moved to archive.');
    } catch {
      notify.error('Archive failed', 'Please try again.');
    }
  }

  const columns = useMemo<ColumnDef<NotificationItem>[]>(
    () => [
      {
        id: 'severity',
        header: 'Severity',
        size: 90,
        accessorFn: (row) => row.severity,
        cell: ({ row }) => {
          const n = row.original;
          const Icon = SEVERITY_ICON[n.severity];
          const color = SEVERITY_COLOR[n.severity];
          return (
            <Tooltip label={n.severity} withArrow>
              <Icon
                size={16}
                color={`var(--mantine-color-${color}-6)`}
                aria-label={`${n.severity} severity`}
                role="img"
              />
            </Tooltip>
          );
        },
      },
      {
        id: 'category',
        header: 'Category',
        size: 180,
        accessorFn: (row) => row.category,
        cell: ({ getValue }) => (
          <Badge size="xs" variant="outline" color="gray">
            {formatCategoryLabel(getValue<string>())}
          </Badge>
        ),
      },
      {
        id: 'title',
        header: 'Title',
        size: 400,
        accessorFn: (row) => row.title,
        cell: ({ row }) => {
          const n = row.original;
          const unread = n.read_at === null;
          return (
            <Stack gap={2} miw={0}>
              <Text
                size="sm"
                fw={unread ? 700 : 500}
                lineClamp={1}
                data-testid={`notification-row-title-${n.id}`}
              >
                {n.title}
              </Text>
              <Text size="xs" lineClamp={1} c="var(--mantine-color-gray-8)">
                {n.body}
              </Text>
            </Stack>
          );
        },
      },
      {
        id: 'at',
        header: 'When',
        size: 140,
        accessorFn: (row) => row.at,
        cell: ({ row }) => {
          const n = row.original;
          const absolute = dayjs(n.at).format('YYYY-MM-DD HH:mm:ss');
          return (
            <Tooltip label={absolute} withArrow>
              <Text size="xs" ff="monospace">
                {dayjs(n.at).fromNow()}
              </Text>
            </Tooltip>
          );
        },
      },
      {
        id: 'state',
        header: 'State',
        size: 110,
        accessorFn: (row) =>
          row.archived_at !== null ? 'archived' : row.read_at === null ? 'unread' : 'read',
        cell: ({ getValue }) => {
          const v = getValue<string>();
          const color = v === 'unread' ? 'blue' : v === 'archived' ? 'gray' : 'teal';
          return (
            <Badge size="xs" variant="light" color={color}>
              {v}
            </Badge>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 120,
        enableSorting: false,
        cell: ({ row }) => {
          const n = row.original;
          return (
            <Group gap={2} wrap="nowrap">
              {n.read_at === null && (
                <Tooltip label="Mark as read" withArrow>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label={`Mark "${n.title}" as read`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void doMarkRead(n.id);
                    }}
                    disabled={!canManageOwn}
                    data-testid={`notification-row-mark-read-${n.id}`}
                  >
                    <IconCheck size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              {n.archived_at === null && (
                <Tooltip label="Archive" withArrow>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label={`Archive "${n.title}"`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void doArchive(n.id);
                    }}
                    disabled={!canManageOwn}
                    data-testid={`notification-row-archive-${n.id}`}
                  >
                    <IconArchive size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label={`View details for "${n.title}"`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelect(n);
                }}
                data-testid={`notification-row-view-${n.id}`}
              >
                <IconEye size={14} />
              </ActionIcon>
            </Group>
          );
        },
      },
    ],
    [canManageOwn, onSelect],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      sorting
      pagination={{ pageSize: 50 }}
      urlSyncKey="notifications"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconBell}
          title="No notifications"
          description="Nothing matches the current filters — clear them to see every notification."
        />
      }
      caption="Notifications"
    />
  );
}
