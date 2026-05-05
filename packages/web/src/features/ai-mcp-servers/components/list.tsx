/**
 * <McpServerList> — DataTable of MCP servers for a tenant.
 *
 * Columns: name + description, url (monospace truncated), auth_kind badge,
 * exposed tool count, health chip, enabled Switch, last_seen_at (relative),
 * actions menu (Edit / Test connection / Delete).
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Stack, Menu, ActionIcon, Switch } from '@mantine/core';
import {
  IconDots,
  IconPencil,
  IconTrash,
  IconPlugConnected,
  IconServer,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { McpHealthChip } from '@/features/ai-shared';
import type { McpServer } from '@/api/resources';
import { useMcpServerList, updateMcpServer } from '../api';
import type { McpServerFilter } from '../types';

dayjs.extend(relativeTime);

interface McpServerListProps {
  tenantId: string;
  filter: McpServerFilter;
  onSelect: (srv: McpServer) => void;
  onEdit: (srv: McpServer) => void;
  onTest: (srv: McpServer) => void;
  onDelete: (srv: McpServer) => void;
}

const AUTH_COLORS: Record<McpServer['auth_kind'], string> = {
  none: 'gray',
  bearer: 'blue',
  'api-key': 'violet',
};

export function McpServerList({
  tenantId,
  filter,
  onSelect,
  onEdit,
  onTest,
  onDelete,
}: McpServerListProps) {
  const servers = useMcpServerList(tenantId, filter);

  const columns = useMemo<ColumnDef<McpServer>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500} ff="monospace">
                {s.name}
              </Text>
              {s.description && (
                <Text size="xs" c="var(--mantine-color-gray-7)" lineClamp={1} title={s.description}>
                  {s.description}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'url',
        header: 'URL',
        accessorFn: (row) => row.url,
        cell: ({ row }) => (
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)" truncate>
            {row.original.url}
          </Text>
        ),
      },
      {
        id: 'auth',
        header: 'Auth',
        size: 110,
        accessorFn: (row) => row.auth_kind,
        cell: ({ row }) => (
          <Badge size="sm" variant="light" color={AUTH_COLORS[row.original.auth_kind]}>
            {row.original.auth_kind}
          </Badge>
        ),
      },
      {
        id: 'tools',
        header: 'Tools',
        size: 80,
        accessorFn: (row) => row.exposed_tool_count,
        cell: ({ getValue }) => <Text size="sm">{String(getValue<number>())}</Text>,
      },
      {
        id: 'health',
        header: 'Health',
        size: 120,
        accessorFn: (row) => row.health,
        cell: ({ row }) => <McpHealthChip health={row.original.health} />,
      },
      {
        id: 'enabled',
        header: 'Enabled',
        size: 100,
        accessorFn: (row) => row.enabled,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <Switch
              checked={s.enabled}
              aria-label={`Toggle ${s.name}`}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onChange={(e) => {
                void updateMcpServer(s.id, { enabled: e.currentTarget.checked });
              }}
            />
          );
        },
      },
      {
        id: 'last_seen',
        header: 'Last seen',
        size: 140,
        accessorFn: (row) => row.last_seen_at ?? '',
        cell: ({ row }) => {
          const seen = row.original.last_seen_at;
          return (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              {seen ? dayjs(seen).fromNow() : 'never'}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <Menu shadow="md" width={180} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${s.name}`}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(s);
                  }}
                >
                  Edit
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconPlugConnected size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTest(s);
                  }}
                >
                  Test connection
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s);
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
    [onEdit, onTest, onDelete],
  );

  return (
    <DataTable
      data={servers}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="ai-mcp-servers"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconServer}
          title="No MCP servers"
          description="Connect an MCP server to expose its tools to your agents."
        />
      }
      caption="MCP Servers"
    />
  );
}
