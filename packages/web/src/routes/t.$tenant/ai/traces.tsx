/**
 * AI Traces page — /t/$tenant/ai/traces
 *
 * Filterable, paginated list with drawer-based detail viewer. URL-synced
 * search + agent + status + date-range filter. Accepts `agent` cross-link
 * param to pre-apply an agent filter when navigated to from the agent
 * detail drawer.
 *
 * Permission guard: ai-trace:read. Sensitive search (prompt/completion text)
 * is gated inside the filter bar on ai-trace:read-sensitive.
 */
import { useCallback, useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  Stack,
  Title,
  Group,
  Drawer,
  Badge,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  TraceList,
  TraceFilterBar,
  useTraceList,
} from '@/features/ai-traces';
import type { RangePreset, TraceFilter } from '@/features/ai-traces';
import type { AiTrace } from '@/api/resources/types';

const MAX_ROWS = 500;
const STATUS_VALUES: readonly AiTrace['status'][] = [
  'success',
  'error',
  'timeout',
];
const PRESET_VALUES: readonly RangePreset[] = [
  '1h',
  '24h',
  '7d',
  'all',
  'custom',
];

interface SearchParams {
  search: string;
  agent_ids: string[];
  statuses: AiTrace['status'][];
  range: RangePreset;
  since?: string;
  until?: string;
  agent?: string; // cross-link convenience param → folds into agent_ids
  selected?: string;
}

function parseCsv(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof v !== 'string') return [];
  if (v.length === 0) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseStatuses(v: unknown): AiTrace['status'][] {
  return parseCsv(v).filter((s): s is AiTrace['status'] =>
    (STATUS_VALUES as readonly string[]).includes(s),
  );
}

function parseRange(v: unknown): RangePreset {
  if (typeof v === 'string' && (PRESET_VALUES as readonly string[]).includes(v)) {
    return v as RangePreset;
  }
  return '24h';
}

function AiTracesPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  // Cross-link: `agent` query param folds into agent_ids (dedup).
  const agentIds = useMemo(() => {
    const out = [...search.agent_ids];
    if (search.agent && !out.includes(search.agent)) out.push(search.agent);
    return out;
  }, [search.agent_ids, search.agent]);

  const filter: TraceFilter = useMemo(() => {
    const f: TraceFilter = {
      search: search.search,
      agent_ids: agentIds,
      statuses: search.statuses,
    };
    if (search.since) f.since = search.since;
    if (search.until) f.until = search.until;
    return f;
  }, [search.search, agentIds, search.statuses, search.since, search.until]);

  const rangePreset = search.range;

  const setFilter = useCallback(
    (next: TraceFilter, nextRange: RangePreset) => {
      void navigate({
        to: '/t/$tenant/ai/traces',
        params: { tenant: tenantSlug },
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          search: next.search,
          agent_ids: next.agent_ids.join(','),
          statuses: next.statuses.join(','),
          range: nextRange,
          since: next.since ?? '',
          until: next.until ?? '',
          // Clear the transient `agent` cross-link param once the filter is
          // materialized into agent_ids, so subsequent changes don't duplicate.
          agent: '',
        }),
        replace: true,
      } as unknown as Parameters<typeof navigate>[0]);
    },
    [navigate, tenantSlug],
  );

  const baseRows = useTraceList(tenantId, filter);
  const visibleRows = useMemo(() => baseRows.slice(0, MAX_ROWS), [baseRows]);
  const totalCount = baseRows.length;

  // Drawer state — detail viewer lands in Task 3d.20.
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure(false);
  const [selected, setSelected] = useState<AiTrace | null>(null);

  function handleRowClick(t: AiTrace) {
    setSelected(t);
    openDrawer();
  }

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Group gap="sm" align="center">
          <Title order={2}>AI Traces</Title>
          <Badge variant="light" color="gray" size="sm">
            Showing {String(visibleRows.length)} of {String(totalCount)}
          </Badge>
        </Group>
      </Group>

      <TraceFilterBar
        tenantId={tenantId}
        filter={filter}
        rangePreset={rangePreset}
        onChange={setFilter}
      />

      <TraceList rows={visibleRows} onSelect={handleRowClick} />

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title={selected ? `Trace · ${selected.request_id}` : 'Trace detail'}
        position="right"
        size="xl"
        padding="md"
      >
        {selected && (
          <Text size="sm" c="var(--mantine-color-gray-7)">
            Trace {selected.request_id} · tenant {tenantSlug}. Detail viewer
            lands in task 3d.20.
          </Text>
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/traces')({
  beforeLoad: requirePermissions({ required: ['ai-trace:read'] }),
  component: AiTracesPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    agent_ids: parseCsv(s.agent_ids),
    statuses: parseStatuses(s.statuses),
    range: parseRange(s.range),
    ...(typeof s.since === 'string' && s.since.length > 0
      ? { since: s.since }
      : {}),
    ...(typeof s.until === 'string' && s.until.length > 0
      ? { until: s.until }
      : {}),
    ...(typeof s.agent === 'string' && s.agent.length > 0
      ? { agent: s.agent }
      : {}),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
