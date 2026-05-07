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
import { Stack, Title, Group, Drawer, Badge, Switch, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAccessPoint, IconDownload } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  TraceList,
  TraceFilterBar,
  TraceDetail,
  LiveTailBadge,
  exportTracesCsv,
  useTraceList,
  useTraceStream,
} from '@/features/ai-traces';
import type { RangePreset, TraceFilter } from '@/features/ai-traces';
import type { AiTrace } from '@/api/resources';

const MAX_ROWS = 500;
const STATUS_VALUES: readonly AiTrace['status'][] = ['success', 'error', 'timeout'];
const PRESET_VALUES: readonly RangePreset[] = ['1h', '24h', '7d', 'all', 'custom'];

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

  const tenantId = tenant;
  const tenantSlug = tenant;

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

  const baseRows = useTraceList(tenantSlug, filter);
  const visibleRows = useMemo(() => baseRows.slice(0, MAX_ROWS), [baseRows]);
  const totalCount = baseRows.length;

  // Live-tail toggle. `useTraceStream` subscribes to the mock-SSE bus while
  // `tailEnabled` is true; the store re-renders via Zustand so the list
  // picks up prepended rows automatically. We only track a counter here.
  const [tailEnabled, setTailEnabled] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const handleLiveTrace = useCallback(() => {
    setLiveCount((c) => c + 1);
  }, []);
  useTraceStream(tenantSlug, tailEnabled, handleLiveTrace);

  const handleTailToggle = useCallback((next: boolean) => {
    setTailEnabled(next);
    // Reset the counter on both transitions — clean slate every time the
    // user flips the switch.
    setLiveCount(0);
  }, []);

  // Drawer state for detail viewer.
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [selected, setSelected] = useState<AiTrace | null>(null);

  function handleRowClick(t: AiTrace) {
    setSelected(t);
    openDrawer();
  }

  async function handleExport() {
    try {
      const blob = await exportTracesCsv(tenantSlug, filter);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-traces-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify.success('Export complete', `Downloaded ${String(totalCount)} traces.`);
    } catch {
      notify.error('Export failed', 'Please try again.');
    }
  }

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Group gap="sm" align="center">
          <Title order={2}>AI Traces</Title>
          <Badge variant="light" color="gray" size="sm">
            Showing {String(visibleRows.length)} of {String(totalCount)}
          </Badge>
          {tailEnabled && <LiveTailBadge liveCount={liveCount} />}
        </Group>
        <Group gap="sm">
          <Switch
            label="Live tail"
            checked={tailEnabled}
            onChange={(e) => {
              handleTailToggle(e.currentTarget.checked);
            }}
            thumbIcon={<IconAccessPoint size={10} />}
            aria-label="Toggle live trace tail"
            data-testid="live-tail-switch"
          />
          <Button
            variant="subtle"
            leftSection={<IconDownload size={14} />}
            onClick={() => {
              void handleExport();
            }}
            aria-label="Export traces as CSV"
            data-testid="export-csv"
          >
            Export CSV
          </Button>
        </Group>
      </Group>

      <TraceFilterBar
        tenantId={tenantId}
        filter={filter}
        rangePreset={rangePreset}
        onChange={setFilter}
      />

      <TraceList rows={visibleRows} onSelect={handleRowClick} />

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={selected ? `Trace · ${selected.request_id}` : 'Trace detail'}
        position="right"
        size="min(520px, 95vw)"
        padding="md"
      >
        {selected && (
          <TraceDetail traceId={selected.id} tenantSlug={tenantSlug} onClose={closeDrawer} />
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
    ...(typeof s.since === 'string' && s.since.length > 0 ? { since: s.since } : {}),
    ...(typeof s.until === 'string' && s.until.length > 0 ? { until: s.until } : {}),
    ...(typeof s.agent === 'string' && s.agent.length > 0 ? { agent: s.agent } : {}),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
