/**
 * <TraceList> — DataTable of AI traces for a tenant.
 *
 * Columns: timestamp (relative + hover full ISO), agent name, model, request_id
 * (copyable IdBadge), tokens split (in/out), latency_ms, cost (formatCost),
 * status chip.
 *
 * Row click → onSelect(trace) → parent opens <TraceDetail> drawer.
 *
 * The raw list is pinned to the newest 500 traces to keep the table responsive.
 * Parent renders a "Showing N of M total" chip from total/visible counts.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Group, Text, Tooltip, Box } from '@mantine/core';
import { IconHistory } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { IdBadge } from '@/components/id-badge';
import { StatusBadge } from '@/components/status-badge';
import { formatCost, formatTokens } from '@/features/ai-shared';
import { useAgentList } from '@/features/ai-agents/api';
import type { AgentFilter } from '@/features/ai-agents/types';
import type { AiTrace } from '@/api/resources';

const EMPTY_AGENT_FILTER: AgentFilter = {
  search: '',
  provider_ids: [],
  role_ids: [],
};

dayjs.extend(relativeTime);

const STATUS_KIND = {
  success: 'success',
  error: 'error',
  timeout: 'warn',
} as const satisfies Record<AiTrace['status'], 'success' | 'error' | 'warn'>;

interface TraceListProps {
  /** Tenant slug — used to resolve agent display names. */
  tenantId: string;
  /** Pre-filtered + sorted + sliced trace rows to render. */
  rows: AiTrace[];
  onSelect: (trace: AiTrace) => void;
}

export function TraceList({ tenantId, rows, onSelect }: TraceListProps) {
  const agentList = useAgentList(tenantId, EMPTY_AGENT_FILTER);
  const agents = useMemo(() => {
    const map: Record<string, { name: string }> = {};
    for (const a of agentList) map[a.id] = { name: a.name };
    return map;
  }, [agentList]);

  const columns = useMemo<ColumnDef<AiTrace>[]>(
    () => [
      {
        id: 'at',
        header: 'When',
        size: 140,
        accessorFn: (row) => row.at,
        cell: ({ row }) => {
          const t = row.original;
          const absolute = dayjs(t.at).format('YYYY-MM-DD HH:mm:ss');
          return (
            <Tooltip label={absolute} withArrow>
              <Text size="xs" ff="monospace">
                {dayjs(t.at).fromNow()}
              </Text>
            </Tooltip>
          );
        },
      },
      {
        id: 'agent',
        header: 'Agent',
        size: 200,
        accessorFn: (row) => agents[row.agent_id]?.name ?? row.agent_id,
        cell: ({ getValue }) => (
          <Text size="sm" ff="monospace">
            {getValue<string>()}
          </Text>
        ),
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
        id: 'request_id',
        header: 'Request ID',
        size: 160,
        accessorFn: (row) => row.request_id,
        cell: ({ row }) => (
          <Box
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <IdBadge id={row.original.request_id} />
          </Box>
        ),
      },
      {
        id: 'tokens',
        header: 'Tokens',
        size: 140,
        accessorFn: (row) => row.input_tokens + row.output_tokens,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <Group gap={4} wrap="nowrap">
              <Text size="xs" ff="monospace">
                {formatTokens(t.input_tokens)}
              </Text>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                →
              </Text>
              <Text size="xs" ff="monospace">
                {formatTokens(t.output_tokens)}
              </Text>
            </Group>
          );
        },
      },
      {
        id: 'latency',
        header: 'Latency',
        size: 100,
        accessorFn: (row) => row.latency_ms,
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace">
            {String(getValue<number>())}ms
          </Text>
        ),
      },
      {
        id: 'cost',
        header: 'Cost',
        size: 100,
        accessorFn: (row) => row.cost_usd,
        cell: ({ row }) => (
          <Text size="xs" ff="monospace">
            {formatCost(row.original.cost_usd)}
          </Text>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        size: 100,
        accessorFn: (row) => row.status,
        cell: ({ getValue }) => {
          const v = getValue<AiTrace['status']>();
          return (
            <StatusBadge kind={STATUS_KIND[v]} size="xs">
              {v}
            </StatusBadge>
          );
        },
      },
    ],
    [agents],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      sorting
      pagination={{ pageSize: 50 }}
      urlSyncKey="ai-traces"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconHistory}
          title="No traces"
          description="No trace has been recorded yet — invoke an agent to write one."
        />
      }
      caption="AI Traces"
    />
  );
}
