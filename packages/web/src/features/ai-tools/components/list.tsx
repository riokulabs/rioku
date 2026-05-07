/**
 * <ToolList> — DataTable list of AI tools for a tenant.
 *
 * Columns: name/description, kind badge, dangerous flag, target preview,
 * enabled Switch, actions.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Stack, Group, Menu, ActionIcon, Switch } from '@mantine/core';
import { IconDots, IconPencil, IconTool, IconTrash } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { DangerousToolBadge, ToolKindBadge } from '@/features/ai-shared';
import { useToolList, useUpdateTool } from '../api';
import type { AiTool, ToolFilter } from '../types';

interface ToolListProps {
  tenant: string;
  filter: ToolFilter;
  onSelect: (tool: AiTool) => void;
  onEdit: (tool: AiTool) => void;
  onDelete: (tool: AiTool) => void;
}

export function ToolList({ tenant, filter, onSelect, onEdit, onDelete }: ToolListProps) {
  const tools = useToolList(tenant, filter);
  const updateMutation = useUpdateTool(tenant);

  const columns = useMemo<ColumnDef<AiTool>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <Stack gap={2}>
              <Group gap={4}>
                <Text size="sm" fw={500} ff="monospace">
                  {t.name}
                </Text>
                {t.dangerous && <DangerousToolBadge />}
              </Group>
              {t.description && (
                <Text size="xs" c="var(--mantine-color-gray-7)" lineClamp={1} title={t.description}>
                  {t.description}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'kind',
        header: 'Kind',
        size: 90,
        accessorFn: (row) => row.kind,
        cell: ({ row }) => <ToolKindBadge kind={row.original.kind} />,
      },
      {
        id: 'target',
        header: 'Target',
        accessorFn: (row) => row.http_endpoint?.url ?? row.mcp_server_id ?? '',
        cell: ({ row }) => {
          const t = row.original;
          if (t.kind === 'mcp' && t.mcp_server_id) {
            return (
              <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
                MCP · {t.mcp_server_id}
              </Text>
            );
          }
          if (t.kind === 'http' && t.http_endpoint) {
            return (
              <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)" truncate>
                {t.http_endpoint.method} {t.http_endpoint.url}
              </Text>
            );
          }
          return (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              native
            </Text>
          );
        },
      },
      {
        id: 'enabled',
        header: 'Enabled',
        size: 100,
        accessorFn: (row) => row.enabled,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <Switch
              checked={t.enabled}
              aria-label={`Toggle ${t.name}`}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onChange={(e) => {
                const enabled = e.currentTarget.checked;
                updateMutation.mutate({ id: t.id, input: { enabled } });
              }}
            />
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <Menu shadow="md" width={180} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${t.name}`}
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
                    onEdit(t);
                  }}
                >
                  Edit
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(t);
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
    [onEdit, onDelete, updateMutation],
  );

  // Suppress unused warning when no tools are present.
  void Badge;

  return (
    <DataTable
      data={tools}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="ai-tools"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconTool}
          title="No tools"
          description="Create your first tool to expose functionality to your agents."
        />
      }
      caption="AI Tools"
    />
  );
}
