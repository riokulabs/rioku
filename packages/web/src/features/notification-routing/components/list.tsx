/**
 * <RoutingRuleList> — DataTable of notification routing rules.
 *
 * Columns: name, monospace event_filter, channel count (chips), enabled
 * Switch, order_hint, and a combined reorder/actions cell. Reorder uses
 * ActionIcon up/down arrows (no dnd dep) — click dispatches a full-array
 * `reorderRoutingRules(tenantId, newOrder)` call.
 */
import { useCallback, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { ActionIcon, Badge, Group, Menu, Switch, Text } from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconDots,
  IconPencil,
  IconRoute,
  IconTrash,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useChannelList } from '@/features/notification-channels/api';
import type { ChannelFilter } from '@/features/notification-channels/types';
import { reorderRoutingRules, updateRoutingRule, useRoutingRuleList } from '../api';
import type { NotificationRoutingRule, RoutingRuleFilter } from '../types';

const EMPTY_CHANNEL_FILTER: ChannelFilter = {
  kinds: [],
  enabled: undefined,
  search: '',
};

interface RoutingRuleListProps {
  tenantId: string;
  filter: RoutingRuleFilter;
  onSelect: (r: NotificationRoutingRule) => void;
  onEdit: (r: NotificationRoutingRule) => void;
  onDelete: (r: NotificationRoutingRule) => void;
}

export function RoutingRuleList({
  tenantId,
  filter,
  onSelect,
  onEdit,
  onDelete,
}: RoutingRuleListProps) {
  const rules = useRoutingRuleList(tenantId, filter);
  const channelList = useChannelList(tenantId, EMPTY_CHANNEL_FILTER);
  const channels = useMemo(() => {
    const m: Record<string, (typeof channelList)[number]> = {};
    for (const c of channelList) m[c.id] = c;
    return m;
  }, [channelList]);
  const canWrite = usePermission('notification-routing:write');

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const handleToggle = useCallback(
    async (r: NotificationRoutingRule, next: boolean) => {
      setTogglingId(r.id);
      try {
        await updateRoutingRule(r.id, { enabled: next });
        notify.success(
          next ? 'Rule enabled' : 'Rule disabled',
          `${r.name} is now ${next ? 'active' : 'inactive'}.`,
        );
      } catch {
        notify.error('Failed to toggle rule', 'Please try again.');
      } finally {
        setTogglingId(null);
      }
    },
    [],
  );

  const handleMove = useCallback(
    async (index: number, direction: 'up' | 'down') => {
      const delta = direction === 'up' ? -1 : 1;
      const target = index + delta;
      if (target < 0 || target >= rules.length) return;
      const ids = rules.map((r) => r.id);
      const a = ids[index];
      const b = ids[target];
      if (a === undefined || b === undefined) return;
      const next = [...ids];
      next[index] = b;
      next[target] = a;
      setReordering(true);
      try {
        await reorderRoutingRules(tenantId, next);
      } catch {
        notify.error('Failed to reorder rules', 'Please try again.');
      } finally {
        setReordering(false);
      }
    },
    [rules, tenantId],
  );

  const columns = useMemo<ColumnDef<NotificationRoutingRule>[]>(
    () => [
      {
        id: 'order_hint',
        header: 'Order',
        size: 100,
        accessorFn: (row) => row.order_hint,
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace">
            {String(getValue<number>())}
          </Text>
        ),
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
        id: 'event_filter',
        header: 'Event filter',
        size: 220,
        accessorFn: (row) => row.event_filter,
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace">
            {getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'channels',
        header: 'Channels',
        size: 260,
        enableSorting: false,
        accessorFn: (row) => row.channel_ids.length,
        cell: ({ row }) => {
          const r = row.original;
          if (r.channel_ids.length === 0) {
            return (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                No channels
              </Text>
            );
          }
          return (
            <Group gap={4} wrap="wrap">
              {r.channel_ids.slice(0, 4).map((cid) => {
                const c = channels[cid];
                return (
                  <Badge key={cid} size="xs" variant="light" color="blue">
                    {c?.name ?? cid}
                  </Badge>
                );
              })}
              {r.channel_ids.length > 4 && (
                <Badge size="xs" variant="outline" color="gray">
                  +{String(r.channel_ids.length - 4)}
                </Badge>
              )}
            </Group>
          );
        },
      },
      {
        id: 'enabled',
        header: 'Enabled',
        size: 100,
        accessorFn: (row) => row.enabled,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Switch
              checked={r.enabled}
              disabled={togglingId === r.id || !canWrite}
              aria-label={r.enabled ? `Disable ${r.name}` : `Enable ${r.name}`}
              onChange={(e) => {
                e.stopPropagation();
                void handleToggle(r, e.currentTarget.checked);
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            />
          );
        },
      },
      {
        id: 'reorder',
        header: 'Reorder',
        size: 100,
        enableSorting: false,
        cell: ({ row }) => {
          const idx = row.index;
          return (
            <Group gap={2}>
              <ActionIcon
                size="sm"
                variant="subtle"
                disabled={idx === 0 || reordering || !canWrite}
                aria-label={`Move ${row.original.name} up`}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleMove(idx, 'up');
                }}
              >
                <IconArrowUp size={14} />
              </ActionIcon>
              <ActionIcon
                size="sm"
                variant="subtle"
                disabled={idx === rules.length - 1 || reordering || !canWrite}
                aria-label={`Move ${row.original.name} down`}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleMove(idx, 'down');
                }}
              >
                <IconArrowDown size={14} />
              </ActionIcon>
            </Group>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Menu shadow="md" width={160} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${r.name}`}
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
                    onEdit(r);
                  }}
                >
                  Edit
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  disabled={!canWrite}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(r);
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
    [
      channels,
      togglingId,
      reordering,
      rules.length,
      canWrite,
      onEdit,
      onDelete,
      handleMove,
      handleToggle,
    ],
  );

  return (
    <DataTable
      data={rules}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="notif-routing"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconRoute}
          title="No routing rules"
          description="Create a rule to fan notifications out to channels."
        />
      }
      caption="Notification routing rules"
    />
  );
}
