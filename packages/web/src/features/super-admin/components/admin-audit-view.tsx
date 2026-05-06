/**
 * <AdminAuditView> — super-admin cross-tenant audit log with chain verification.
 *
 * Features:
 *   - Filter by actor, tenant target, action kind, date range
 *   - Detail drawer: Overview / Diff / Hash-chain integrity tabs
 *   - Hash-chain integrity verification in browser
 *
 * spec §8.1 §8.4 / Task 1d.78 / Plan 11
 */
import { useState, useMemo } from 'react';
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
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import {
  IconShieldCheck,
  IconShieldOff,
  IconFileText,
  IconSearch,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { IdBadge } from '@/components/id-badge';
import { useMockStore } from '@/api/mock-store';
import { verifyAdminAuditChain } from '@/api/resources/audit';
import type { AdminAuditEntry } from '@/api/resources';

type VerifyResult =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'valid' }
  | { status: 'broken'; entry: number };

// ─── Entry detail drawer ──────────────────────────────────────────────────────

function AuditEntryDetailDrawer({
  entry,
  entryIndex,
  allEntries,
}: {
  entry: AdminAuditEntry | null;
  entryIndex: number;
  allEntries: AdminAuditEntry[];
}) {
  const users = useMockStore((s) => s.users);
  const [chainResult, setChainResult] = useState<
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'ok' }
    | { status: 'broken' }
  >({ status: 'idle' });

  if (!entry) return null;

  const actorName = users[entry.actor_id]?.name ?? entry.actor_id;

  async function handleVerifyChainUpTo() {
    setChainResult({ status: 'checking' });
    const slice = allEntries.slice(0, entryIndex + 1);
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
            <Text size="xs" c="dimmed">Actor</Text>
            <Text size="sm">{actorName}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Action</Text>
            <Badge variant="light" size="sm">{entry.action}</Badge>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Resource type</Text>
            <Text size="sm">{entry.resource_type}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Resource ID</Text>
            <Text size="sm" ff="monospace">{entry.resource_id ?? '—'}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Tenant target</Text>
            <Text size="sm" ff="monospace">{entry.tenant_id ?? '—'}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Outcome</Text>
            <Badge color={entry.outcome === 'success' ? 'green' : 'red'} variant="light" size="sm">
              {entry.outcome}
            </Badge>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Tier</Text>
            <Badge variant="outline" size="sm">{entry.tier}</Badge>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Timestamp</Text>
            <Text size="xs" ff="monospace">{new Date(entry.at).toLocaleString()}</Text>
          </Box>
        </SimpleGrid>
      </Tabs.Panel>

      <Tabs.Panel value="diff">
        {entry.diff ? (
          <Stack gap="xs">
            <Text size="xs" c="dimmed" fw={600}>Before</Text>
            <ScrollArea>
              <Code block>{JSON.stringify(entry.diff.before, null, 2)}</Code>
            </ScrollArea>
            <Text size="xs" c="dimmed" fw={600}>After</Text>
            <ScrollArea>
              <Code block>{JSON.stringify(entry.diff.after, null, 2)}</Code>
            </ScrollArea>
          </Stack>
        ) : entry.payload !== undefined ? (
          <Stack gap="xs">
            <Text size="xs" c="dimmed" fw={600}>Payload</Text>
            <ScrollArea>
              <Code block>{JSON.stringify(entry.payload, null, 2)}</Code>
            </ScrollArea>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">No diff or payload recorded for this entry.</Text>
        )}
      </Tabs.Panel>

      <Tabs.Panel value="chain">
        <Stack gap="md">
          <SimpleGrid cols={1} spacing="xs">
            <Box>
              <Text size="xs" c="dimmed">Entry hash</Text>
              <Code>{entry.hash}</Code>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">Prev hash</Text>
              <Code>{entry.prev_hash || '(genesis)'}</Code>
            </Box>
          </SimpleGrid>

          <Group>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconShieldCheck size={14} />}
              onClick={() => { void handleVerifyChainUpTo(); }}
              loading={chainResult.status === 'checking'}
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
  const adminAudit = useMockStore((s) => s.adminAudit);
  const users = useMockStore((s) => s.users);
  const tenants = useMockStore((s) => s.tenants);

  const [verifyResult, setVerifyResult] = useState<VerifyResult>({ status: 'idle' });
  const [detailEntry, setDetailEntry] = useState<AdminAuditEntry | null>(null);
  const [detailIndex, setDetailIndex] = useState<number>(0);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [tenantFilter, setTenantFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);

  const actorOptions = useMemo(
    () => [
      { value: 'all', label: 'All actors' },
      ...Object.values(users).map((u) => ({ value: u.id, label: u.name })),
    ],
    [users],
  );

  const tenantOptions = useMemo(
    () => [
      { value: 'all', label: 'All tenants' },
      { value: '__global__', label: 'Global (no tenant)' },
      ...Object.values(tenants).map((t) => ({ value: t.id, label: t.slug })),
    ],
    [tenants],
  );

  // Chronological order for chain ops
  const chronologicalEntries = useMemo(
    () => [...adminAudit].sort((a, b) => a.at.localeCompare(b.at)),
    [adminAudit],
  );

  const filteredEntries = useMemo(() => {
    return chronologicalEntries.filter((e) => {
      if (actorFilter !== 'all' && e.actor_id !== actorFilter) return false;
      if (tenantFilter === '__global__' && e.tenant_id !== null) return false;
      if (
        tenantFilter !== 'all' &&
        tenantFilter !== '__global__' &&
        e.tenant_id !== tenantFilter
      )
        return false;
      if (kindFilter && !e.action.toLowerCase().includes(kindFilter.toLowerCase())) return false;
      if (dateFrom && new Date(e.at) < dateFrom) return false;
      if (dateTo) {
        const toEnd = new Date(dateTo);
        toEnd.setHours(23, 59, 59, 999);
        if (new Date(e.at) > toEnd) return false;
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
    setVerifyResult({ status: 'verifying' });
    const result = await verifyAdminAuditChain(chronologicalEntries);
    if (result.ok) {
      setVerifyResult({ status: 'valid' });
    } else {
      setVerifyResult({ status: 'broken', entry: result.brokenAt ?? 0 });
    }
  }

  function actorName(entry: AdminAuditEntry): string {
    const user = users[entry.actor_id];
    return user ? user.name : entry.actor_id;
  }

  function openDetail(entry: AdminAuditEntry) {
    const idx = chronologicalEntries.findIndex((e) => e.id === entry.id);
    setDetailIndex(idx >= 0 ? idx : 0);
    setDetailEntry(entry);
  }

  const columns: ColumnDef<AdminAuditEntry>[] = [
    {
      accessorKey: 'at',
      header: 'Timestamp',
      cell: (info) => (
        <Text size="xs" ff="monospace">
          {new Date(info.getValue<string>()).toLocaleString()}
        </Text>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (info) => <Text size="sm">{actorName(info.row.original)}</Text>,
    },
    {
      accessorKey: 'action',
      header: 'Action',
      cell: (info) => (
        <Badge variant="light" size="sm">
          {info.getValue<string>()}
        </Badge>
      ),
    },
    {
      id: 'tenant',
      header: 'Tenant',
      cell: (info) => (
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {info.row.original.tenant_id ?? '—'}
        </Text>
      ),
    },
    {
      id: 'resource',
      header: 'Resource',
      cell: (info) => (
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {info.row.original.resource_type}
        </Text>
      ),
    },
    {
      id: 'hash',
      header: 'Hash',
      cell: (info) => <IdBadge id={info.row.original.hash} />,
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
          <Button
            variant="light"
            leftSection={<IconShieldCheck size={16} />}
            onClick={() => {
              void handleVerify();
            }}
            loading={verifyResult.status === 'verifying'}
          >
            Verify chain
          </Button>
        </Group>
      </Group>

      {/* Filters */}
      <Group gap="sm" wrap="wrap">
        <Select
          placeholder="Filter by actor"
          data={actorOptions}
          value={actorFilter}
          onChange={(v) => { setActorFilter(v ?? 'all'); }}
          clearable={false}
          style={{ minWidth: 160 }}
          data-testid="actor-filter"
        />
        <Select
          placeholder="Filter by tenant"
          data={tenantOptions}
          value={tenantFilter}
          onChange={(v) => { setTenantFilter(v ?? 'all'); }}
          clearable={false}
          style={{ minWidth: 160 }}
          data-testid="tenant-filter"
        />
        <TextInput
          placeholder="Filter by action kind…"
          leftSection={<IconSearch size={14} />}
          value={kindFilter}
          onChange={(e) => { setKindFilter(e.currentTarget.value); }}
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

      {sortedEntries.length === 0 ? (
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
        onClose={() => { setDetailEntry(null); }}
        title="Audit entry detail"
        position="right"
        size="lg"
        padding="md"
      >
        <AuditEntryDetailDrawer
          entry={detailEntry}
          entryIndex={detailIndex}
          allEntries={chronologicalEntries}
        />
      </Drawer>
    </Stack>
  );
}
