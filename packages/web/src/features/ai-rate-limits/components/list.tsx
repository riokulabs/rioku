/**
 * <RateLimitList> — DataTable of AI semantic rate-limit rules for a tenant.
 *
 * Columns: name, scope chip (with linked-name for agent/tool), action badge,
 * threshold, window, max_matches, enabled Switch, embedded sparkline, actions.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Stack, Menu, ActionIcon, Switch } from '@mantine/core';
import { IconDots, IconPencil, IconTrash, IconGauge } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useMockStore } from '@/api/mock-store';
import type { AiSemanticRateLimit } from '@/api/resources';
import { useRateLimitList, updateRateLimit } from '../api';
import type { RateLimitFilter } from '../types';
import { MetricsSparkline } from './metrics-sparkline';

interface RateLimitListProps {
  tenantId: string;
  filter: RateLimitFilter;
  onSelect: (rule: AiSemanticRateLimit) => void;
  onEdit: (rule: AiSemanticRateLimit) => void;
  onDelete: (rule: AiSemanticRateLimit) => void;
}

const ACTION_COLORS: Record<AiSemanticRateLimit['action'], string> = {
  block: 'red',
  degrade: 'yellow',
  log: 'blue',
};

function formatWindow(seconds: number): string {
  if (seconds % 3600 === 0) return `${String(seconds / 3600)}h`;
  if (seconds % 60 === 0) return `${String(seconds / 60)}m`;
  return `${String(seconds)}s`;
}

export function RateLimitList({
  tenantId,
  filter,
  onSelect,
  onEdit,
  onDelete,
}: RateLimitListProps) {
  const rules = useRateLimitList(tenantId, filter);
  const agents = useMockStore((s) => s.aiAgents);
  const tools = useMockStore((s) => s.aiTools);

  const columns = useMemo<ColumnDef<AiSemanticRateLimit>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500} ff="monospace">
                {r.name}
              </Text>
              {r.description && (
                <Text size="xs" c="var(--mantine-color-gray-7)" lineClamp={1} title={r.description}>
                  {r.description}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'scope',
        header: 'Scope',
        size: 160,
        accessorFn: (row) => row.scope,
        cell: ({ row }) => {
          const r = row.original;
          const target =
            r.scope === 'agent' && r.agent_id
              ? agents[r.agent_id]?.name
              : r.scope === 'tool' && r.tool_id
                ? tools[r.tool_id]?.name
                : undefined;
          return (
            <Stack gap={2}>
              <Badge size="xs" variant="outline" color="gray">
                {r.scope}
              </Badge>
              {target && (
                <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
                  {target}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'action',
        header: 'Action',
        size: 100,
        accessorFn: (row) => row.action,
        cell: ({ row }) => (
          <Badge size="sm" variant="light" color={ACTION_COLORS[row.original.action]}>
            {row.original.action}
          </Badge>
        ),
      },
      {
        id: 'threshold',
        header: 'Threshold',
        size: 100,
        accessorFn: (row) => row.similarity_threshold,
        cell: ({ row }) => (
          <Text size="xs" ff="monospace">
            {row.original.similarity_threshold.toFixed(2)}
          </Text>
        ),
      },
      {
        id: 'window',
        header: 'Window',
        size: 80,
        accessorFn: (row) => row.window_seconds,
        cell: ({ row }) => (
          <Text size="xs" ff="monospace">
            {formatWindow(row.original.window_seconds)}
          </Text>
        ),
      },
      {
        id: 'max',
        header: 'Max',
        size: 80,
        accessorFn: (row) => row.max_matches,
        cell: ({ row }) => (
          <Text size="xs" ff="monospace">
            {String(row.original.max_matches)}
          </Text>
        ),
      },
      {
        id: 'metrics',
        header: 'Last 24h',
        size: 120,
        enableSorting: false,
        cell: ({ row }) => (
          <MetricsSparkline
            tenantId={tenantId}
            ruleId={row.original.id}
            size="sm"
            window="24h"
          />
        ),
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
              aria-label={`Toggle ${r.name}`}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onChange={(e) => {
                void updateRateLimit(tenantId, r.id, {
                  enabled: e.currentTarget.checked,
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
    [tenantId, agents, tools, onEdit, onDelete],
  );

  return (
    <DataTable
      data={rules}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="ai-rate-limits"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconGauge}
          title="No rate limits"
          description="Add a semantic rate-limit rule to throttle abusive or noisy patterns."
        />
      }
      caption="AI Rate Limits"
    />
  );
}
