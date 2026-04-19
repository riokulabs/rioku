/**
 * <AuditList> — main audit log page component.
 *
 * Features:
 *   - Bounded filters: action, outcome, resource_type, tier (MultiSelect, URL-safe)
 *   - Unbounded filters: actor_id, resource_id (opaque handle via useOpaqueFilter)
 *   - Date range filter via DatePickerInput (Mantine Dates)
 *   - DataTable with pagination (25 per page)
 *   - Row click opens detail drawer
 *   - Tail live toggle (subscribes to mockBus 'audit:new')
 *   - Export CSV / JSONL via ExportDialog
 */
import { useState, useCallback } from 'react';
import {
  Stack,
  Title,
  Group,
  Button,
  Badge,
  Drawer,
  Text,
  MultiSelect,
  Collapse,
  ActionIcon,
  Tooltip,
  Box,
  Pagination,
  Alert,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import {
  IconFilter,
  IconDownload,
  IconRadioactive,
  IconRadioactiveFilled,
  IconInfoCircle,
} from '@tabler/icons-react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable, TimestampCell } from '@/components/data-table';
import { IdBadge } from '@/components/id-badge';
import { EmptyState } from '@/components/empty-state';
import { useOpaqueFilter } from '@/hooks/use-opaque-filter';
import { useMockStore } from '@/api/mock-store';
import { useAuditList, useAuditTail } from '../api';
import { AuditEntryDetail } from './detail-drawer';
import { TailIndicator } from './tail-indicator';
import { ExportDialog } from './export-dialog';
import { useAuditExport } from '../api';
import type { AuditEntryWithContext, AuditFilter, ExportFormat } from '../types';
import { DEFAULT_AUDIT_FILTER } from '../types';

// ── Filter options ─────────────────────────────────────────────────────────────

const ACTION_OPTIONS = [
  'user.login', 'user.logout', 'user.invite', 'user.disable',
  'role.create', 'role.update', 'role.delete',
  'service.create', 'service.update', 'service.health_check',
  'route.create', 'route.delete',
  'api_key.create', 'api_key.revoke',
  'session.create', 'session.revoke',
  'policy.create', 'policy.update',
  'plugin.install', 'plugin.enable', 'plugin.disable',
  'tenant.update', 'site.create', 'site.update',
].map((a) => ({ value: a, label: a }));

const OUTCOME_OPTIONS = [
  { value: 'success', label: 'Success' },
  { value: 'denied', label: 'Denied' },
  { value: 'error', label: 'Error' },
];

const RESOURCE_TYPE_OPTIONS = [
  'user', 'role', 'service', 'route', 'api_key', 'session',
  'policy', 'plugin', 'tenant', 'site',
].map((r) => ({ value: r, label: r }));

const TIER_OPTIONS = [
  { value: 'read', label: 'Read' },
  { value: 'read-sensitive', label: 'Read Sensitive' },
  { value: 'write', label: 'Write' },
  { value: 'destructive', label: 'Destructive' },
];

const OUTCOME_COLOR: Record<string, string> = {
  success: 'green',
  denied: 'orange',
  error: 'red',
};

const TIER_COLOR: Record<string, string> = {
  read: 'blue',
  'read-sensitive': 'violet',
  write: 'yellow',
  destructive: 'red',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface AuditListProps {
  tenantId: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuditList({ tenantId }: AuditListProps) {
  // Bounded filters — URL-safe, no PII
  const [actions, setActions] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);
  const [tiers, setTiers] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);

  // Unbounded filters — go through opaque filter (PII-safe URL)
  const { filter: opaqueFilter, setFilter: setOpaqueFilter } =
    useOpaqueFilter<{ actor_id: string; resource_id: string }>({
      actor_id: '',
      resource_id: '',
    });

  // Compose the full filter
  const filter: AuditFilter = {
    ...DEFAULT_AUDIT_FILTER,
    actions,
    outcomes: outcomes as AuditFilter['outcomes'],
    resource_types: resourceTypes,
    tiers: tiers as AuditFilter['tiers'],
    actor_id: opaqueFilter.actor_id,
    resource_id: opaqueFilter.resource_id,
    date_from: dateRange[0]?.toISOString() ?? '',
    date_to: dateRange[1]?.toISOString() ?? '',
  };

  // Data
  const { entries, total, page, pageCount, setPage, liveEntries, appendLive } =
    useAuditList(filter, tenantId);

  // Tail
  const [tailActive, setTailActive] = useState(false);
  useAuditTail(tailActive, appendLive);

  // Export
  const { exportEntries, count: exportCount } = useAuditExport(filter, tenantId);
  const [exportDialogOpen, { open: openExportDialog, close: closeExportDialog }] =
    useDisclosure(false);

  function handleExport(fmt: ExportFormat) {
    exportEntries(fmt);
  }

  // Detail drawer
  const [selectedEntry, setSelectedEntry] = useState<AuditEntryWithContext | null>(null);
  const [detailOpen, { open: openDetail, close: closeDetail }] = useDisclosure(false);

  const handleRowClick = useCallback((entry: AuditEntryWithContext) => {
    setSelectedEntry(entry);
    openDetail();
  }, [openDetail]);

  // Get users for actor ID search
  const users = useMockStore((s) => s.users);
  const userOptions = Object.values(users).map((u) => ({
    value: u.id,
    label: u.name,
  }));

  // Columns
  const columns: ColumnDef<AuditEntryWithContext>[] = [
    {
      id: 'at',
      header: 'Time',
      accessorKey: 'at',
      size: 160,
      cell: ({ getValue }) => (
        <TimestampCell value={getValue<string>()} format="relative" />
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      accessorFn: (row) => row.actor_name,
      size: 140,
      cell: ({ getValue }) => (
        <Text size="sm" truncate>
          {getValue<string>()}
        </Text>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      accessorKey: 'action',
      cell: ({ getValue }) => (
        <Text size="sm" ff="monospace">
          {getValue<string>()}
        </Text>
      ),
    },
    {
      id: 'resource_type',
      header: 'Resource',
      accessorKey: 'resource_type',
      size: 120,
      cell: ({ getValue }) => (
        <Text size="sm" c="dimmed">
          {getValue<string>()}
        </Text>
      ),
    },
    {
      id: 'resource_id',
      header: 'Resource ID',
      accessorKey: 'resource_id',
      size: 120,
      cell: ({ getValue }) => {
        const id = getValue<string | undefined>();
        return id ? <IdBadge id={id} /> : <Text size="sm" c="dimmed">—</Text>;
      },
    },
    {
      id: 'outcome',
      header: 'Outcome',
      accessorKey: 'outcome',
      size: 100,
      cell: ({ getValue }) => {
        const v = getValue<string>();
        return (
          <Badge size="sm" color={OUTCOME_COLOR[v] ?? 'gray'} variant="light">
            {v}
          </Badge>
        );
      },
    },
    {
      id: 'tier',
      header: 'Tier',
      accessorKey: 'tier',
      size: 120,
      cell: ({ getValue }) => {
        const v = getValue<string>();
        return (
          <Badge size="sm" color={TIER_COLOR[v] ?? 'gray'} variant="outline">
            {v}
          </Badge>
        );
      },
    },
  ];

  const activeFilterCount = [
    actions.length > 0,
    outcomes.length > 0,
    resourceTypes.length > 0,
    tiers.length > 0,
    opaqueFilter.actor_id !== '',
    opaqueFilter.resource_id !== '',
    dateRange[0] !== null,
  ].filter(Boolean).length;

  return (
    <Stack gap="md" data-testid="audit-list">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Title order={2}>Audit Log</Title>
          <Badge variant="light" color="gray" size="sm">
            {total} entries
          </Badge>
          {tailActive && <TailIndicator liveCount={liveEntries.length} />}
        </Group>

        <Group gap="xs">
          <Tooltip label={tailActive ? 'Stop live tail' : 'Tail live'}>
            <ActionIcon
              variant={tailActive ? 'filled' : 'subtle'}
              color={tailActive ? 'teal' : 'gray'}
              onClick={() => { setTailActive((v) => !v); }}
              aria-label={tailActive ? 'Stop live tail' : 'Tail live'}
              data-testid="tail-toggle"
            >
              {tailActive ? <IconRadioactiveFilled size={16} /> : <IconRadioactive size={16} />}
            </ActionIcon>
          </Tooltip>

          <Button
            variant="subtle"
            leftSection={<IconFilter size={14} />}
            onClick={toggleFilters}
            rightSection={
              activeFilterCount > 0 ? (
                <Badge size="xs" color="blue" circle>
                  {activeFilterCount}
                </Badge>
              ) : undefined
            }
            aria-label="Toggle filters"
          >
            Filters
          </Button>

          <Button
            variant="subtle"
            leftSection={<IconDownload size={14} />}
            onClick={openExportDialog}
            aria-label="Export audit log"
            data-testid="export-button"
          >
            Export
          </Button>
        </Group>
      </Group>

      {/* ── Live entries banner ────────────────────────────────────────── */}
      {liveEntries.length > 0 && (
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="teal"
          variant="light"
          data-testid="live-entries-banner"
        >
          {liveEntries.length} new{' '}
          {liveEntries.length === 1 ? 'entry' : 'entries'} received via live tail.
          Scroll up to see them.
        </Alert>
      )}

      {/* ── Filter panel ──────────────────────────────────────────────── */}
      <Collapse expanded={filtersOpen}>
        <Box
          p="sm"
          style={(theme) => ({
            border: `1px solid ${theme.colors.gray[3]}`,
            borderRadius: theme.radius.sm,
          })}
          data-testid="filter-panel"
        >
          <Stack gap="sm">
            <Group grow>
              <MultiSelect
                label="Actions"
                data={ACTION_OPTIONS}
                value={actions}
                onChange={setActions}
                searchable
                clearable
                placeholder="All actions"
                aria-label="Filter by action"
              />
              <MultiSelect
                label="Outcome"
                data={OUTCOME_OPTIONS}
                value={outcomes}
                onChange={setOutcomes}
                clearable
                placeholder="All outcomes"
                aria-label="Filter by outcome"
              />
            </Group>
            <Group grow>
              <MultiSelect
                label="Resource type"
                data={RESOURCE_TYPE_OPTIONS}
                value={resourceTypes}
                onChange={setResourceTypes}
                clearable
                placeholder="All resource types"
                aria-label="Filter by resource type"
              />
              <MultiSelect
                label="Tier"
                data={TIER_OPTIONS}
                value={tiers}
                onChange={setTiers}
                clearable
                placeholder="All tiers"
                aria-label="Filter by tier"
              />
            </Group>
            <Group grow>
              <MultiSelect
                label="Actor (user)"
                data={userOptions}
                value={opaqueFilter.actor_id ? [opaqueFilter.actor_id] : []}
                onChange={(vals) => {
                  setOpaqueFilter({
                    ...opaqueFilter,
                    actor_id: vals[0] ?? '',
                  });
                }}
                searchable
                clearable
                maxValues={1}
                placeholder="All actors"
                aria-label="Filter by actor"
                data-testid="actor-filter"
              />
              <DatePickerInput
                type="range"
                label="Date range"
                placeholder="All dates"
                value={dateRange}
                onChange={(val) => {
                  // Mantine dates v9 range onChange signature: [Date|null, Date|null] or [string|null, string|null]
                  const cast = val as [Date | null, Date | null];
                  setDateRange(cast);
                }}
                clearable
                aria-label="Filter by date range"
              />
            </Group>
          </Stack>
        </Box>
      </Collapse>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <DataTable
        data={entries}
        columns={columns}
        sorting
        pagination={false}
        onRowClick={handleRowClick}
        urlSyncKey="audit"
        emptyState={
          <EmptyState
            icon={IconFilter}
            title="No audit entries"
            description="No entries match the current filters"
          />
        }
        caption="Audit log entries"
      />

      {/* ── Manual pagination ─────────────────────────────────────────── */}
      {pageCount > 1 && (
        <Group justify="center">
          <Pagination
            total={pageCount}
            value={page + 1}
            onChange={(p) => { setPage(p - 1); }}
            data-testid="audit-pagination"
          />
        </Group>
      )}

      {/* ── Detail drawer ─────────────────────────────────────────────── */}
      <Drawer
        opened={detailOpen}
        onClose={closeDetail}
        title={
          selectedEntry ? (
            <Text ff="monospace" size="sm">
              {selectedEntry.action}
            </Text>
          ) : (
            'Audit entry'
          )
        }
        position="right"
        size="lg"
        data-testid="detail-drawer"
      >
        {selectedEntry && <AuditEntryDetail entry={selectedEntry} />}
      </Drawer>

      {/* ── Export dialog ──────────────────────────────────────────────── */}
      <ExportDialog
        opened={exportDialogOpen}
        onClose={closeExportDialog}
        count={exportCount}
        onExport={handleExport}
      />
    </Stack>
  );
}
