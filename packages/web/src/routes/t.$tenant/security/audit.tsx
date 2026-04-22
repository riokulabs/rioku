/**
 * Audit page — /t/$tenant/security/audit
 *
 * Permission guard: requires audit:read.
 *
 * Shape:
 *   Header (title + counts + live-tail switch + pulsing LIVE badge + export)
 *   <AuditFilterBar>
 *   <AuditList>
 *   <Drawer><AuditDetail /></Drawer>
 *
 * URL-synced filter — bounded as CSV, unbounded handles as CSV, dates as
 * ISO strings. Selected row id is also carried so back/forward restore the
 * open drawer.
 *
 * Live-tail uses the Plan 3d trace-store pattern — the mock SSE bus
 * dispatches `AuditEntry` events which `publishAudit` emits alongside
 * `appendAudit`. The Zustand selector picks up new rows automatically;
 * the `useAuditStream` hook is used only to bump the "+N" badge counter.
 */
import { useCallback, useMemo, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  Anchor,
  Badge,
  Button,
  Drawer,
  Group,
  Menu,
  Stack,
  Switch,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAccessPoint, IconChevronDown, IconDownload } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import { usePermission } from '@/hooks/use-permission';
import {
  AuditDetail,
  AuditFilterBar,
  AuditList,
  LiveTailBadge,
  exportAuditCsv,
  exportAuditJsonl,
  useAuditList,
  useAuditStream,
} from '@/features/audit';
import type { AuditEntry, AuditFilter } from '@/features/audit';

// ─── Search params ───────────────────────────────────────────────────────────

interface SearchParams {
  actions: string[];
  outcomes: AuditFilter['outcomes'];
  resource_types: string[];
  tiers: AuditFilter['tiers'];
  actor_handles: string[];
  resource_id_handles: string[];
  search: string;
  date_from: string | null;
  date_to: string | null;
  selected?: string;
}

const OUTCOME_VALUES: readonly AuditFilter['outcomes'][number][] = ['success', 'denied', 'error'];
const TIER_VALUES: readonly AuditFilter['tiers'][number][] = [
  'read',
  'read-sensitive',
  'write',
  'destructive',
];

function parseCsv(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof v !== 'string' || v.length === 0) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseOutcomes(v: unknown): AuditFilter['outcomes'] {
  return parseCsv(v).filter((x): x is AuditFilter['outcomes'][number] =>
    (OUTCOME_VALUES as readonly string[]).includes(x),
  );
}

function parseTiers(v: unknown): AuditFilter['tiers'] {
  return parseCsv(v).filter((x): x is AuditFilter['tiers'][number] =>
    (TIER_VALUES as readonly string[]).includes(x),
  );
}

function parseIso(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
}

// ─── Page component ──────────────────────────────────────────────────────────

function AuditPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  // Build the filter from URL-synced search params. Filter identity changes
  // only when an underlying value changes; deriving it via useMemo keeps the
  // list-hook from thrashing on unrelated re-renders.
  const filter: AuditFilter = useMemo(
    () => ({
      actions: search.actions,
      outcomes: search.outcomes,
      resource_types: search.resource_types,
      tiers: search.tiers,
      actor_handles: search.actor_handles,
      resource_id_handles: search.resource_id_handles,
      search: search.search,
      date_from: search.date_from,
      date_to: search.date_to,
    }),
    [
      search.actions,
      search.outcomes,
      search.resource_types,
      search.tiers,
      search.actor_handles,
      search.resource_id_handles,
      search.search,
      search.date_from,
      search.date_to,
    ],
  );

  const rows = useAuditList(tenantId, filter);

  // Drawer state — selected id persists to URL so back/forward restore it.
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(
    Boolean(search.selected),
  );
  const selectedEntry = useMemo<AuditEntry | null>(() => {
    if (!search.selected) return null;
    return rows.find((e) => e.id === search.selected) ?? null;
  }, [rows, search.selected]);

  const updateSearch = useCallback(
    (mutate: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      void navigate({
        to: '/t/$tenant/security/audit',
        params: { tenant: tenantSlug },
        search: mutate,
        replace: true,
      } as unknown as Parameters<typeof navigate>[0]);
    },
    [navigate, tenantSlug],
  );

  const handleFilterChange = useCallback(
    (next: AuditFilter) => {
      updateSearch(() => ({
        actions: next.actions.join(','),
        outcomes: next.outcomes.join(','),
        resource_types: next.resource_types.join(','),
        tiers: next.tiers.join(','),
        actor_handles: next.actor_handles.join(','),
        resource_id_handles: next.resource_id_handles.join(','),
        search: next.search,
        date_from: next.date_from ?? '',
        date_to: next.date_to ?? '',
      }));
    },
    [updateSearch],
  );

  const handleRowSelect = useCallback(
    (entry: AuditEntry) => {
      updateSearch((prev) => ({ ...prev, selected: entry.id }));
      openDrawer();
    },
    [openDrawer, updateSearch],
  );

  const handleDrawerClose = useCallback(() => {
    closeDrawer();
    updateSearch((prev) => ({ ...prev, selected: '' }));
  }, [closeDrawer, updateSearch]);

  // Live-tail mode. `useAuditStream` subscribes to the mock bus while
  // `tailEnabled` is true; the store re-renders via Zustand so `useAuditList`
  // picks up new entries automatically. We only track a counter here.
  const [tailEnabled, setTailEnabled] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const handleLiveEntry = useCallback(() => {
    setLiveCount((c) => c + 1);
  }, []);
  useAuditStream(tenantId, tailEnabled, handleLiveEntry);

  const handleTailToggle = useCallback((next: boolean) => {
    setTailEnabled(next);
    // Reset the counter on every transition — clean slate each flip.
    setLiveCount(0);
  }, []);

  // Export gate: users without audit:export cannot download. The API layer
  // still redacts PII fields when the session lacks audit:read-sensitive,
  // so no separate "redact sensitive" checkbox is needed in the UI.
  const canExport = usePermission('audit:export');

  const handleExport = useCallback(
    (format: 'csv' | 'jsonl') => {
      try {
        const blob =
          format === 'csv' ? exportAuditCsv(tenantId, filter) : exportAuditJsonl(tenantId, filter);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const datestamp = new Date().toISOString().slice(0, 10);
        a.download = `audit-${tenantSlug}-${datestamp}.${format === 'csv' ? 'csv' : 'jsonl'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify.success(
          'Export complete',
          `Downloaded ${String(rows.length)} entries as ${format.toUpperCase()}.`,
        );
      } catch {
        notify.error('Export failed', 'Please try again.');
      }
    },
    [tenantId, tenantSlug, filter, rows.length],
  );

  return (
    <Stack gap="md" p="md" data-testid="audit-page">
      <Group justify="space-between" align="center">
        <Group gap="sm" align="center">
          <Title order={2}>Audit log</Title>
          <Badge variant="light" color="gray" size="sm">
            {String(rows.length)} entries
          </Badge>
          {tailEnabled && <LiveTailBadge newCount={liveCount} isLive={tailEnabled} />}
        </Group>
        <Group gap="sm">
          <Anchor
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
            component={Link as any}
            to="/t/$tenant/settings/audit-retention"
            params={{ tenant: tenantSlug }}
            size="sm"
            data-testid="audit-retention-link"
          >
            Configure retention
          </Anchor>
          <Switch
            label="Live tail"
            checked={tailEnabled}
            onChange={(e) => {
              handleTailToggle(e.currentTarget.checked);
            }}
            thumbIcon={<IconAccessPoint size={10} />}
            aria-label="Toggle live audit tail"
            data-testid="audit-live-tail-switch"
          />
          <Menu shadow="md" width={160} disabled={!canExport}>
            <Menu.Target>
              <Tooltip
                label="You don't have permission to export audit entries"
                disabled={canExport}
                withArrow
              >
                {/* Tooltip requires its child to forward refs; wrapping the
                    button in a span keeps the tooltip anchored even when
                    the button is disabled (disabled buttons swallow
                    pointer events otherwise). */}
                <span>
                  <Button
                    variant="subtle"
                    leftSection={<IconDownload size={14} />}
                    rightSection={<IconChevronDown size={14} />}
                    aria-label="Export audit entries"
                    data-testid="audit-export-menu"
                    disabled={!canExport}
                  >
                    Export
                  </Button>
                </span>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                onClick={() => {
                  handleExport('csv');
                }}
                data-testid="audit-export-csv"
              >
                CSV
              </Menu.Item>
              <Menu.Item
                onClick={() => {
                  handleExport('jsonl');
                }}
                data-testid="audit-export-jsonl"
              >
                JSONL
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <AuditFilterBar tenantId={tenantId} filter={filter} onChange={handleFilterChange} />

      <AuditList rows={rows} onSelect={handleRowSelect} />

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={handleDrawerClose}
        title={selectedEntry ? `Audit · ${selectedEntry.action}` : 'Audit entry'}
        position="right"
        size="min(520px, 95vw)"
        padding="md"
      >
        {selectedEntry && <AuditDetail entry={selectedEntry} onClose={handleDrawerClose} />}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/audit')({
  beforeLoad: requirePermissions({ required: ['audit:read'] }),
  component: AuditPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    actions: parseCsv(s.actions),
    outcomes: parseOutcomes(s.outcomes),
    resource_types: parseCsv(s.resource_types),
    tiers: parseTiers(s.tiers),
    actor_handles: parseCsv(s.actor_handles),
    resource_id_handles: parseCsv(s.resource_id_handles),
    search: typeof s.search === 'string' ? s.search : '',
    date_from: parseIso(s.date_from),
    date_to: parseIso(s.date_to),
    ...(typeof s.selected === 'string' && s.selected.length > 0 ? { selected: s.selected } : {}),
  }),
});
