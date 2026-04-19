/**
 * <AgentList> — DataTable list of AI agents for a tenant.
 *
 * Columns: name, provider (name + kind badge), model, tool count,
 * recent-traces count (last 24h), enabled Switch, actions.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Badge,
  Text,
  Stack,
  Group,
  Menu,
  ActionIcon,
  Switch,
} from '@mantine/core';
import {
  IconDots,
  IconPencil,
  IconTrash,
  IconRobot,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { ProviderKindBadge } from '@/features/ai-shared';
import { useMockStore } from '@/api/mock-store';
import { useAgentList, updateAgent } from '../api';
import type { AiAgent, AgentFilter } from '../types';

interface AgentListProps {
  tenantId: string;
  filter: AgentFilter;
  onSelect: (agent: AiAgent) => void;
  onEdit: (agent: AiAgent) => void;
  onDelete: (agent: AiAgent) => void;
  onInvoke: (agent: AiAgent) => void;
}

export function AgentList({
  tenantId,
  filter,
  onSelect,
  onEdit,
  onDelete,
  onInvoke,
}: AgentListProps) {
  const agents = useAgentList(tenantId, filter);
  const providers = useMockStore((s) => s.aiProviders);
  const traces = useMockStore((s) => s.aiTraces);

  // Derive 24h trace counts per agent outside the selector.
  const recentTraceCounts = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const counts: Record<string, number> = {};
    for (const t of Object.values(traces)) {
      if (new Date(t.at).getTime() >= cutoff) {
        counts[t.agent_id] = (counts[t.agent_id] ?? 0) + 1;
      }
    }
    return counts;
  }, [traces]);

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
                <Text
                  size="xs"
                  c="var(--mantine-color-gray-7)"
                  lineClamp={1}
                  title={a.description}
                >
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
          const p = providers[row.original.provider_id];
          if (!p) {
            return (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                unknown
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
        id: 'traces24h',
        header: '24h traces',
        size: 100,
        accessorFn: (row) => recentTraceCounts[row.id] ?? 0,
        cell: ({ getValue }) => (
          <Badge size="xs" variant="light" color="gray">
            {String(getValue<number>())}
          </Badge>
        ),
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
                void updateAgent(a.id, { enabled: e.currentTarget.checked });
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
    [providers, recentTraceCounts, onEdit, onInvoke, onDelete],
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
