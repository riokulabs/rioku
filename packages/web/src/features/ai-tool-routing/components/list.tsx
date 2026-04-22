/**
 * <BindingList> — DataTable list of AI tool bindings for a tenant.
 *
 * Columns: agent, tool, CEL condition (monospace truncated), enabled Switch,
 * actions.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Stack, Menu, ActionIcon, Switch } from '@mantine/core';
import { IconDots, IconPencil, IconTrash, IconRouter } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useMockStore } from '@/api/mock-store';
import { useBindingList, updateBinding } from '../api';
import type { AiToolBinding, BindingFilter } from '../types';

interface BindingListProps {
  tenantId: string;
  filter: BindingFilter;
  onSelect: (b: AiToolBinding) => void;
  onEdit: (b: AiToolBinding) => void;
  onDelete: (b: AiToolBinding) => void;
}

export function BindingList({ tenantId, filter, onSelect, onEdit, onDelete }: BindingListProps) {
  const bindings = useBindingList(tenantId, filter);
  const agents = useMockStore((s) => s.aiAgents);
  const tools = useMockStore((s) => s.aiTools);

  const columns = useMemo<ColumnDef<AiToolBinding>[]>(
    () => [
      {
        id: 'agent',
        header: 'Agent',
        accessorFn: (row) => agents[row.agent_id]?.name ?? row.agent_id,
        cell: ({ row }) => {
          const b = row.original;
          const agent = agents[b.agent_id];
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500} ff="monospace">
                {agent?.name ?? b.agent_id}
              </Text>
              {agent?.model && (
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  {agent.model}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'tool',
        header: 'Tool',
        accessorFn: (row) => tools[row.tool_id]?.name ?? row.tool_id,
        cell: ({ row }) => {
          const b = row.original;
          const tool = tools[b.tool_id];
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500} ff="monospace">
                {tool?.name ?? b.tool_id}
              </Text>
              {tool?.kind && (
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  {tool.kind}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'condition',
        header: 'Condition',
        accessorFn: (row) => row.condition,
        cell: ({ row }) => {
          const cond = row.original.condition;
          if (cond.trim() === '') {
            return (
              <Badge size="xs" variant="outline" color="gray">
                (unconditional)
              </Badge>
            );
          }
          return (
            <Text
              size="xs"
              ff="monospace"
              c="var(--mantine-color-gray-7)"
              lineClamp={1}
              title={cond}
            >
              {cond}
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
          const b = row.original;
          return (
            <Switch
              checked={b.enabled}
              aria-label={`Toggle binding ${b.id}`}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onChange={(e) => {
                void updateBinding(b.id, { enabled: e.currentTarget.checked });
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
          const b = row.original;
          return (
            <Menu shadow="md" width={160} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for binding ${b.id}`}
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
                    onEdit(b);
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
                    onDelete(b);
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
    [agents, tools, onEdit, onDelete],
  );

  return (
    <DataTable
      data={bindings}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="ai-tool-bindings"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconRouter}
          title="No bindings"
          description="Attach tools to agents to control which tools each agent may invoke."
        />
      }
      caption="AI Tool Bindings"
    />
  );
}
