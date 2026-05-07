/**
 * <AgentList> — DataTable list of AI agents for a tenant.
 *
 * Backed by the real daemon (`useAgentList` returns adapted AiAgent records).
 * Provider name lookup falls back to mock-store when the agent's provider_id
 * matches a seeded mock provider; otherwise the raw provider id is shown.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Text, Stack, Group, Menu, ActionIcon, Switch } from '@mantine/core';
import { IconDots, IconPencil, IconTrash, IconRobot, IconPlayerPlay } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { ProviderKindBadge } from '@/features/ai-shared';
import { useMockStore } from '@/api/mock-store';
import { useAgentList, useUpdateAgent } from '../api';
import type { AiAgent, AgentFilter } from '../types';

interface AgentListProps {
  /** Tenant slug — passed straight to the daemon URL. */
  tenant: string;
  filter: AgentFilter;
  onSelect: (agent: AiAgent) => void;
  onEdit: (agent: AiAgent) => void;
  onDelete: (agent: AiAgent) => void;
  onInvoke: (agent: AiAgent) => void;
}

export function AgentList({
  tenant,
  filter,
  onSelect,
  onEdit,
  onDelete,
  onInvoke,
}: AgentListProps) {
  const agents = useAgentList(tenant, filter);
  const updateMut = useUpdateAgent(tenant);
  // Provider names + kinds come from the still-mock-backed providers feature.
  const providers = useMockStore((s) => s.aiProviders);

  const columns = useMemo<ColumnDef<AiAgent>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => {
          const a = row.original;
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500} ff="monospace">
                {a.name}
              </Text>
              {a.description && (
                <Text size="xs" c="var(--mantine-color-gray-7)" lineClamp={1} title={a.description}>
                  {a.description}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'provider',
        header: 'Provider',
        size: 200,
        accessorFn: (row) => row.provider_id,
        cell: ({ row }) => {
          const a = row.original;
          const p = providers[a.provider_id];
          if (!p) {
            return (
              <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
                {a.provider_id || 'unset'}
              </Text>
            );
          }
          return (
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" ff="monospace">
                {p.name}
              </Text>
              <ProviderKindBadge kind={p.kind} />
            </Group>
          );
        },
      },
      {
        id: 'model',
        header: 'Model',
        size: 180,
        accessorFn: (row) => row.model,
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'tools',
        header: 'Tools',
        size: 80,
        accessorFn: (row) => row.tool_ids.length,
        cell: ({ getValue }) => <Text size="sm">{String(getValue<number>())}</Text>,
      },
      {
        id: 'enabled',
        header: 'Enabled',
        size: 100,
        accessorFn: (row) => row.enabled,
        cell: ({ row }) => {
          const a = row.original;
          return (
            <Switch
              checked={a.enabled}
              aria-label={`Toggle ${a.name}`}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onChange={(e) => {
                updateMut.mutate({
                  id: a.id,
                  input: { enabled: e.currentTarget.checked },
                });
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
          const a = row.original;
          return (
            <Menu shadow="md" width={180} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${a.name}`}
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
                    onEdit(a);
                  }}
                >
                  Edit
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onInvoke(a);
                  }}
                >
                  Invoke
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(a);
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
    [providers, onEdit, onInvoke, onDelete, updateMut],
  );

  return (
    <DataTable
      data={agents}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="ai-agents"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconRobot}
          title="No agents"
          description="Create your first AI agent to route prompts to a provider."
        />
      }
      caption="AI Agents"
    />
  );
}
