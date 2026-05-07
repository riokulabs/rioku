/**
 * <DashboardList> — DataTable list of dashboards for a tenant.
 *
 * Columns: name (with truncated description below), owner (user chip or
 * "Tenant-shared"), mode badge, scope chip, widget count, default chip,
 * last updated (relative), actions menu.
 *
 * Row click → navigate to viewer.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Stack, Menu, ActionIcon, Group, Tooltip } from '@mantine/core';
import {
  IconDots,
  IconPencil,
  IconTrash,
  IconStar,
  IconCopy,
  IconLayoutDashboard,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useUserList } from '@/features/security/users/api';
import { useDashboardList } from '../api';
import type { Dashboard, DashboardFilter } from '../types';

dayjs.extend(relativeTime);

const MODE_COLORS: Record<Dashboard['mode'], string> = {
  metabase: 'blue',
  grafana: 'violet',
};

const SCOPE_COLORS: Record<Dashboard['scope'], string> = {
  personal: 'grape',
  tenant: 'teal',
  shared: 'indigo',
};

interface DashboardListProps {
  tenantId: string;
  filter: DashboardFilter;
  /**
   * Optional extra filter applied client-side after the feature hook's query.
   * Used by the route to layer owner filtering (not carried in DashboardFilter).
   */
  extraFilter?: (d: Dashboard) => boolean;
  onSelect: (dashboard: Dashboard) => void;
  onEdit: (dashboard: Dashboard) => void;
  onClone: (dashboard: Dashboard) => void;
  onDelete: (dashboard: Dashboard) => void;
  onSetDefault: (dashboard: Dashboard) => void;
  canWrite: boolean;
  canDelete: boolean;
  canSetDefault: boolean;
}

export function DashboardList({
  tenantId,
  filter,
  extraFilter,
  onSelect,
  onEdit,
  onClone,
  onDelete,
  onSetDefault,
  canWrite,
  canDelete,
  canSetDefault,
}: DashboardListProps) {
  const baseDashboards = useDashboardList(tenantId, filter);
  const dashboards = extraFilter ? baseDashboards.filter(extraFilter) : baseDashboards;
  const userList = useUserList(tenantId, { search: '', status: 'all' });
  const users = useMemo(() => {
    const m: Record<string, { name: string }> = {};
    for (const { user } of userList.items) m[user.id] = { name: user.name };
    return m;
  }, [userList.items]);

  const columns = useMemo<ColumnDef<Dashboard>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => {
          const d = row.original;
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500}>
                {d.name}
              </Text>
              {d.description && (
                <Text size="xs" c="var(--mantine-color-gray-7)" lineClamp={1} title={d.description}>
                  {d.description}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'owner',
        header: 'Owner',
        size: 180,
        accessorFn: (row) =>
          row.owner_user_id === null
            ? 'Tenant-shared'
            : (users[row.owner_user_id]?.name ?? row.owner_user_id),
        cell: ({ row }) => {
          const d = row.original;
          if (d.owner_user_id === null) {
            return (
              <Badge size="sm" variant="light" color="gray">
                Tenant-shared
              </Badge>
            );
          }
          const user = users[d.owner_user_id];
          return (
            <Text size="sm" ff="monospace">
              {user?.name ?? d.owner_user_id}
            </Text>
          );
        },
      },
      {
        id: 'mode',
        header: 'Mode',
        size: 110,
        accessorFn: (row) => row.mode,
        cell: ({ row }) => (
          <Badge size="sm" variant="light" color={MODE_COLORS[row.original.mode]}>
            {row.original.mode}
          </Badge>
        ),
      },
      {
        id: 'scope',
        header: 'Scope',
        size: 110,
        accessorFn: (row) => row.scope,
        cell: ({ row }) => (
          <Badge size="sm" variant="outline" color={SCOPE_COLORS[row.original.scope]}>
            {row.original.scope}
          </Badge>
        ),
      },
      {
        id: 'widgets',
        header: 'Widgets',
        size: 90,
        accessorFn: (row) => row.widget_ids.length,
        cell: ({ getValue }) => (
          <Text size="sm" ff="monospace">
            {String(getValue<number>())}
          </Text>
        ),
      },
      {
        id: 'default',
        header: 'Default',
        size: 100,
        accessorFn: (row) => row.default,
        cell: ({ row }) =>
          row.original.default ? (
            <Badge size="sm" variant="light" color="green" leftSection={<IconStar size={10} />}>
              Default
            </Badge>
          ) : null,
      },
      {
        id: 'updated_at',
        header: 'Last updated',
        size: 140,
        accessorFn: (row) => row.updated_at,
        cell: ({ row }) => {
          const absolute = dayjs(row.original.updated_at).format('YYYY-MM-DD HH:mm:ss');
          return (
            <Tooltip label={absolute} withArrow>
              <Text size="xs" ff="monospace">
                {dayjs(row.original.updated_at).fromNow()}
              </Text>
            </Tooltip>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        cell: ({ row }) => {
          const d = row.original;
          return (
            <Group justify="flex-end" gap={0}>
              <Menu shadow="md" width={200} position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon
                    variant="subtle"
                    aria-label={`Actions for ${d.name}`}
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
                      onEdit(d);
                    }}
                  >
                    Edit
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconStar size={14} />}
                    disabled={!canSetDefault || d.default}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetDefault(d);
                    }}
                  >
                    Set as default
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconCopy size={14} />}
                    disabled={!canWrite}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClone(d);
                    }}
                  >
                    Clone
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    disabled={!canDelete}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(d);
                    }}
                  >
                    Delete…
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          );
        },
      },
    ],
    [users, onEdit, onClone, onDelete, onSetDefault, canWrite, canDelete, canSetDefault],
  );

  return (
    <DataTable
      data={dashboards}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="dashboards"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconLayoutDashboard}
          title="No dashboards"
          description="Create a dashboard to start building charts and widgets."
        />
      }
      caption="Dashboards"
    />
  );
}
