/**
 * <AdminAuditView> — super-admin cross-tenant audit log with chain verification.
 *
 * Plan 11 close-out: now consumes the real `/api/v1/admin/audit` endpoint via
 * `useListAdminAudit`. The daemon currently proxies the per-tenant audit log
 * (entity_type = "tenant") and returns a `note` field flagging that the
 * hash-chained super-admin audit is a follow-up. When the daemon ships
 * hash-chain entries (with `hash` + `prevHash` fields) the verify-chain button
 * runs `verifyAdminAuditChain` against them; otherwise it surfaces a notice.
 *
 * Features:
 *   - Filter by actor, action kind, date range
 *   - Detail drawer: Overview / Diff / Hash-chain integrity tabs
 *   - Hash-chain integrity verification when entries carry hash fields
 *
 * spec §8.1 §8.4 / Task 1d.78 / Plan 11
 */
import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Stack,
  Title,
  Group,
  Button,
  Badge,
  Text,
  Alert,
  Drawer,
  Tabs,
  Select,
  TextInput,
  Box,
  SimpleGrid,
  Code,
  ScrollArea,
  Loader,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import {
  IconShieldCheck,
  IconShieldOff,
  IconFileText,
  IconSearch,
  IconAlertTriangle,
  IconInfoCircle,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { IdBadge } from '@/components/id-badge';
import { useListAdminAudit } from '@/api/generated/admin/admin';
import { verifyAdminAuditChain } from '@/api/resources/audit';
import type { AdminAuditEntry } from '@/api/resources';

// ─── Server-shape view model ──────────────────────────────────────────────────
//
// The daemon returns proto-JSON-serialised AuditEntry rows today — see
// packages/proto/rioku/v1/config.proto. Hash-chain support lands in a follow-up.
// We accept either the legacy mock-store shape (snake_case, with hash) or the
// daemon shape (camelCase, no hash) and normalise into AuditView.

interface AuditView {
  id: string;
  at: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  tenantId: string | null;
  diff: string | null;
  payload: unknown;
  outcome: string;
  tier: string;
  hash: string | null;
  prevHash: string | null;
  /** Original record, kept for chain verification when hash fields exist. */
  raw: Record<string, unknown>;
}

function readString(rec: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v !== '') return v;
  }
  return '';
}

function readNullableString(rec: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string') return v === '' ? null : v;
    if (v === null) return null;
  }
  return null;
}

function normalise(item: unknown, idx: number): AuditView {
  const rec = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  return {
    id: readString(rec, 'id') || `entry-${String(idx)}`,
    at: readString(rec, 'at', 'occurredAt', 'occurred_at', 'createdAt', 'created_at'),
    actor: readString(rec, 'actor', 'actor_id', 'actorId'),
    action: readString(rec, 'action', 'operation'),
    resourceType: readString(rec, 'resource_type', 'resourceType', 'entityType', 'entity_type'),
    resourceId: readString(rec, 'resource_id', 'resourceId', 'entityId', 'entity_id'),
    tenantId: readNullableString(rec, 'tenant_id', 'tenantId'),
    diff: readNullableString(rec, 'diff'),
    payload: rec.payload ?? rec.payload_schema ?? undefined,
    outcome: readString(rec, 'outcome') || 'success',
    tier: readString(rec, 'tier') || 'write',
    hash: readNullableString(rec, 'hash'),
    prevHash: readNullableString(rec, 'prev_hash', 'prevHash'),
    raw: rec,
  };
}

type VerifyResult =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'valid' }
  | { status: 'broken'; entry: number }
  | { status: 'unsupported' };

// ─── Entry detail drawer ──────────────────────────────────────────────────────

function AuditEntryDetailDrawer({
  entry,
  entryIndex,
  chainEntries,
  hashCapable,
}: {
  entry: AuditView | null;
  entryIndex: number;
  chainEntries: AuditView[];
  hashCapable: boolean;
}) {
  const [chainResult, setChainResult] = useState<
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'ok' }
    | { status: 'broken' }
    | { status: 'unsupported' }
  >({ status: 'idle' });

  if (!entry) return null;

  async function handleVerifyChainUpTo() {
    if (!hashCapable || entry === null) {
      setChainResult({ status: 'unsupported' });
      return;
    }
    setChainResult({ status: 'checking' });
    const slice = chainEntries
      .slice(0, entryIndex + 1)
      .map((e) => e.raw as unknown as AdminAuditEntry);
    const result = await verifyAdminAuditChain(slice);
    setChainResult(result.ok ? { status: 'ok' } : { status: 'broken' });
  }

  return (
    <Tabs defaultValue="overview">
      <Tabs.List mb="md">
        <Tabs.Tab value="overview">Overview</Tabs.Tab>
        <Tabs.Tab value="diff">Diff</Tabs.Tab>
        <Tabs.Tab value="chain">Hash chain</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="overview">
        <SimpleGrid cols={2} spacing="xs">
          <Box>
            <Text size="xs" c="dimmed">
              Actor
            </Text>
            <Text size="sm">{entry.actor || '—'}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Action
            </Text>
            <Badge variant="light" size="sm">
              {entry.action || '—'}
            </Badge>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Resource type
            </Text>
            <Text size="sm">{entry.resourceType || '—'}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Resource ID
            </Text>
            <Text size="sm" ff="monospace">
              {entry.resourceId || '—'}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Tenant target
            </Text>
            <Text size="sm" ff="monospace">
              {entry.tenantId ?? '—'}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Outcome
            </Text>
            <Badge color={entry.outcome === 'success' ? 'green' : 'red'} variant="light" size="sm">
              {entry.outcome}
            </Badge>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Tier
            </Text>
            <Badge variant="outline" size="sm">
              {entry.tier}
            </Badge>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Timestamp
            </Text>
            <Text size="xs" ff="monospace">
              {entry.at ? new Date(entry.at).toLocaleString() : '—'}
            </Text>
          </Box>
        </SimpleGrid>
      </Tabs.Panel>

      <Tabs.Panel value="diff">
        {entry.diff !== null && entry.diff !== '' ? (
          <Stack gap="xs">
            <Text size="xs" c="dimmed" fw={600}>
              Diff
            </Text>
            <ScrollArea>
              <Code block>{entry.diff}</Code>
            </ScrollArea>
          </Stack>
        ) : entry.payload !== undefined ? (
          <Stack gap="xs">
            <Text size="xs" c="dimmed" fw={600}>
              Payload
            </Text>
            <ScrollArea>
              <Code block>{JSON.stringify(entry.payload, null, 2)}</Code>
            </ScrollArea>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            No diff or payload recorded for this entry.
          </Text>
        )}
      </Tabs.Panel>

      <Tabs.Panel value="chain">
        <Stack gap="md">
          {hashCapable ? (
            <SimpleGrid cols={1} spacing="xs">
              <Box>
                <Text size="xs" c="dimmed">
                  Entry hash
                </Text>
                <Code>{entry.hash ?? '(none)'}</Code>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">
                  Prev hash
                </Text>
                <Code>{entry.prevHash ?? '(genesis)'}</Code>
              </Box>
            </SimpleGrid>
          ) : (
            <Alert
              color="blue"
              icon={<IconInfoCircle size={14} />}
              data-testid="chain-unsupported-alert"
            >
              The daemon does not yet emit hash-chained admin audit entries for this row. Hash-chain
              verification will activate once the follow-up migration lands.
            </Alert>
          )}

          <Group>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconShieldCheck size={14} />}
              onClick={() => {
                void handleVerifyChainUpTo();
              }}
              loading={chainResult.status === 'checking'}
              disabled={!hashCapable}
              data-testid="verify-chain-up-to-btn"
            >
              Verify chain up to this entry
            </Button>
          </Group>

          {chainResult.status === 'ok' && (
            <Alert color="green" icon={<IconShieldCheck size={14} />} data-testid="chain-ok-alert">
              Chain intact up to this entry.
            </Alert>
          )}
          {chainResult.status === 'broken' && (
            <Alert color="red" icon={<IconShieldOff size={14} />} data-testid="chain-broken-alert">
              Chain is broken before or at this entry.
            </Alert>
          )}
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminAuditView() {
  const { data, isLoading, isError, error } = useListAdminAudit();

  const [verifyResult, setVerifyResult] = useState<VerifyResult>({ status: 'idle' });
  const [detailEntry, setDetailEntry] = useState<AuditView | null>(null);
  const [detailIndex, setDetailIndex] = useState<number>(0);

  const [actorFilter, setActorFilter] = useState<string>('all');
  const [tenantFilter, setTenantFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);

  const items = useMemo<unknown[]>(() => {
    const raw = data?.data.items;
    return Array.isArray(raw) ? raw : [];
  }, [data]);

  const note = data?.data.note;

  const allEntries = useMemo<AuditView[]>(() => items.map(normalise), [items]);

  // Hash-chain capability — at least one entry has both hash + prev_hash fields.
  const hashCapable = useMemo(
    () => allEntries.some((e) => e.hash !== null && e.prevHash !== null),
    [allEntries],
  );

  // Chronological order for chain ops
  const chronologicalEntries = useMemo(
    () => [...allEntries].sort((a, b) => a.at.localeCompare(b.at)),
    [allEntries],
  );

  const actorOptions = useMemo(() => {
    const uniq = new Set<string>();
    for (const e of allEntries) {
      if (e.actor) uniq.add(e.actor);
    }
    return [
      { value: 'all', label: 'All actors' },
      ...Array.from(uniq).map((a) => ({ value: a, label: a })),
    ];
  }, [allEntries]);

  const tenantOptions = useMemo(() => {
    const uniq = new Set<string>();
    for (const e of allEntries) {
      if (e.tenantId !== null) uniq.add(e.tenantId);
    }
    return [
      { value: 'all', label: 'All tenants' },
      { value: '__global__', label: 'Global (no tenant)' },
      ...Array.from(uniq).map((t) => ({ value: t, label: t })),
    ];
  }, [allEntries]);

  const filteredEntries = useMemo(() => {
    return chronologicalEntries.filter((e) => {
      if (actorFilter !== 'all' && e.actor !== actorFilter) return false;
      if (tenantFilter === '__global__' && e.tenantId !== null) return false;
      if (tenantFilter !== 'all' && tenantFilter !== '__global__' && e.tenantId !== tenantFilter)
        return false;
      if (kindFilter && !e.action.toLowerCase().includes(kindFilter.toLowerCase())) return false;
      if (dateFrom && e.at && new Date(e.at) < new Date(dateFrom)) return false;
      if (dateTo) {
        const toEnd = new Date(dateTo);
        toEnd.setHours(23, 59, 59, 999);
        if (e.at && new Date(e.at) > toEnd) return false;
      }
      return true;
    });
  }, [chronologicalEntries, actorFilter, tenantFilter, kindFilter, dateFrom, dateTo]);

  // Display newest first
  const sortedEntries = useMemo(
    () => [...filteredEntries].sort((a, b) => b.at.localeCompare(a.at)),
    [filteredEntries],
  );

  async function handleVerify() {
    if (!hashCapable) {
      setVerifyResult({ status: 'unsupported' });
      return;
    }
    setVerifyResult({ status: 'verifying' });
    const slice = chronologicalEntries.map((e) => e.raw as unknown as AdminAuditEntry);
    const result = await verifyAdminAuditChain(slice);
    if (result.ok) {
      setVerifyResult({ status: 'valid' });
    } else {
      setVerifyResult({ status: 'broken', entry: result.brokenAt ?? 0 });
    }
  }

  function openDetail(entry: AuditView) {
    const idx = chronologicalEntries.findIndex((e) => e.id === entry.id);
    setDetailIndex(idx >= 0 ? idx : 0);
    setDetailEntry(entry);
  }

  const columns: ColumnDef<AuditView>[] = [
    {
      accessorKey: 'at',
      header: 'Timestamp',
      cell: (info) => {
        const v = info.getValue<string>();
        return (
          <Text size="xs" ff="monospace">
            {v ? new Date(v).toLocaleString() : '—'}
          </Text>
        );
      },
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (info) => <Text size="sm">{info.row.original.actor || '—'}</Text>,
    },
    {
      accessorKey: 'action',
      header: 'Action',
      cell: (info) => (
        <Badge variant="light" size="sm">
          {info.getValue<string>() || '—'}
        </Badge>
      ),
    },
    {
      id: 'tenant',
      header: 'Tenant',
      cell: (info) => (
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {info.row.original.tenantId ?? '—'}
        </Text>
      ),
    },
    {
      id: 'resource',
      header: 'Resource',
      cell: (info) => (
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {info.row.original.resourceType || '—'}
        </Text>
      ),
    },
    {
      id: 'hash',
      header: 'Hash',
      cell: (info) =>
        info.row.original.hash ? (
          <IdBadge id={info.row.original.hash} />
        ) : (
          <Text size="xs" c="dimmed">
            —
          </Text>
        ),
    },
    {
      id: 'detail',
      header: '',
      cell: (info) => (
        <Button
          size="xs"
          variant="subtle"
          onClick={() => {
            openDetail(info.row.original);
          }}
          aria-label={`View details for ${info.row.original.id}`}
        >
          Details
        </Button>
      ),
    },
  ];

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Admin audit log</Title>
        <Group gap="sm">
          {verifyResult.status === 'valid' && (
            <Badge
              color="green"
              variant="light"
              leftSection={<IconShieldCheck size={12} />}
              size="lg"
              data-testid="chain-verified-badge"
            >
              Chain verified
            </Badge>
          )}
          {verifyResult.status === 'broken' && (
            <Badge
              color="red"
              variant="light"
              leftSection={<IconShieldOff size={12} />}
              size="lg"
              data-testid="chain-broken-badge"
            >
              Broken at entry {verifyResult.entry}
            </Badge>
          )}
          {verifyResult.status === 'unsupported' && (
            <Badge
              color="blue"
              variant="light"
              leftSection={<IconInfoCircle size={12} />}
              size="lg"
              data-testid="chain-unsupported-badge"
            >
              Chain not yet emitted
            </Badge>
          )}
          <Button
            variant="light"
            leftSection={<IconShieldCheck size={16} />}
            onClick={() => {
              void handleVerify();
            }}
            loading={verifyResult.status === 'verifying'}
            disabled={!hashCapable && allEntries.length > 0}
          >
            Verify chain
          </Button>
        </Group>
      </Group>

      {note !== undefined && note !== '' && (
        <Alert color="blue" icon={<IconInfoCircle size={14} />} data-testid="audit-note">
          {note}
        </Alert>
      )}

      {/* Filters */}
      <Group gap="sm" wrap="wrap">
        <Select
          placeholder="Filter by actor"
          data={actorOptions}
          value={actorFilter}
          onChange={(v) => {
            setActorFilter(v ?? 'all');
          }}
          clearable={false}
          style={{ minWidth: 160 }}
          data-testid="actor-filter"
        />
        <Select
          placeholder="Filter by tenant"
          data={tenantOptions}
          value={tenantFilter}
          onChange={(v) => {
            setTenantFilter(v ?? 'all');
          }}
          clearable={false}
          style={{ minWidth: 160 }}
          data-testid="tenant-filter"
        />
        <TextInput
          placeholder="Filter by action kind…"
          leftSection={<IconSearch size={14} />}
          value={kindFilter}
          onChange={(e) => {
            setKindFilter(e.currentTarget.value);
          }}
          style={{ minWidth: 180 }}
          data-testid="kind-filter"
        />
        <DatePickerInput
          placeholder="From date"
          value={dateFrom}
          onChange={setDateFrom}
          clearable
          style={{ minWidth: 140 }}
          data-testid="date-from"
        />
        <DatePickerInput
          placeholder="To date"
          value={dateTo}
          onChange={setDateTo}
          clearable
          style={{ minWidth: 140 }}
          data-testid="date-to"
        />
      </Group>

      {isLoading ? (
        <Group justify="center" p="xl">
          <Loader data-testid="audit-loading" />
        </Group>
      ) : isError ? (
        <Alert color="red" icon={<IconAlertTriangle size={14} />} title="Failed to load audit log">
          {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      ) : sortedEntries.length === 0 ? (
        <EmptyState
          icon={IconFileText}
          title="No admin audit entries"
          description="Admin audit entries are created when super-admin actions occur."
        />
      ) : (
        <>
          {verifyResult.status === 'broken' && (
            <Alert color="red" icon={<IconShieldOff size={16} />} title="Chain integrity broken">
              The hash chain is broken at entry {verifyResult.entry}. This may indicate tampering.
            </Alert>
          )}
          <DataTable columns={columns} data={sortedEntries} />
        </>
      )}

      {/* Entry detail drawer */}
      <Drawer
        opened={detailEntry !== null}
        onClose={() => {
          setDetailEntry(null);
        }}
        title="Audit entry detail"
        position="right"
        size="lg"
        padding="md"
      >
        <AuditEntryDetailDrawer
          entry={detailEntry}
          entryIndex={detailIndex}
          chainEntries={chronologicalEntries}
          hashCapable={hashCapable}
        />
      </Drawer>
    </Stack>
  );
}
