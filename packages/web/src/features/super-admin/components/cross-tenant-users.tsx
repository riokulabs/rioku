/**
 * <CrossTenantUsers> — global user registry across all tenants.
 *
 * spec §8.1 / Task 1d.78
 */
import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Stack,
  Title,
  Group,
  Select,
  TextInput,
  Badge,
  Text,
} from '@mantine/core';
import { IconSearch, IconUsers } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useMockStore } from '@/api/mock-store';
import type { Tenant, User, Membership } from '@/api/resources/types';

interface CrossTenantUserRow {
  user: User;
  membership: Membership;
  tenant: Tenant;
}

const STATE_COLORS: Record<string, string> = {
  pending: 'yellow',
  active: 'green',
  deactivated: 'orange',
  removed: 'red',
};

export function CrossTenantUsers() {
  const users = useMockStore((s) => s.users);
  const memberships = useMockStore((s) => s.memberships);
  const tenants = useMockStore((s) => s.tenants);

  const [tenantFilter, setTenantFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  const tenantOptions = useMemo(
    () => [
      { value: 'all', label: 'All tenants' },
      ...Object.values(tenants).map((t) => ({ value: t.id, label: t.name })),
    ],
    [tenants],
  );

  const rows = useMemo((): CrossTenantUserRow[] => {
    return Object.values(memberships)
      .filter((m) => {
        if (tenantFilter && tenantFilter !== 'all' && m.tenant_id !== tenantFilter) return false;
        if (stateFilter !== 'all' && m.state !== stateFilter) return false;
        return true;
      })
      .map((m) => {
        const user = users[m.user_id];
        const tenant = tenants[m.tenant_id];
        if (!user || !tenant) return null;
        return { user, membership: m, tenant };
      })
      .filter((r): r is CrossTenantUserRow => r !== null)
      .filter((r) => {
        if (!debouncedSearch) return true;
        const q = debouncedSearch.toLowerCase();
        return (
          r.user.name.toLowerCase().includes(q) ||
          r.user.email.toLowerCase().includes(q)
        );
      });
  }, [memberships, users, tenants, tenantFilter, stateFilter, debouncedSearch]);

  const columns: ColumnDef<CrossTenantUserRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (info) => <Text size="sm" fw={500}>{info.row.original.user.name}</Text>,
    },
    {
      id: 'email',
      header: 'Email',
      cell: (info) => <Text size="sm" c="dimmed">{info.row.original.user.email}</Text>,
    },
    {
      id: 'tenant',
      header: 'Tenant',
      cell: (info) => (
        <Text size="sm" ff="monospace">{info.row.original.tenant.slug}</Text>
      ),
    },
    {
      id: 'state',
      header: 'State',
      cell: (info) => (
        <Badge
          color={STATE_COLORS[info.row.original.membership.state] ?? 'gray'}
          variant="light"
          size="sm"
        >
          {info.row.original.membership.state}
        </Badge>
      ),
    },
  ];

  return (
    <Stack gap="md" p="md">
      <Title order={2}>All users</Title>

      <Group gap="sm">
        <TextInput
          placeholder="Search by name or email…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => { setSearchInput(e.currentTarget.value); }}
          style={{ flex: 1 }}
        />
        <Select
          placeholder="Filter by tenant"
          data={tenantOptions}
          value={tenantFilter ?? 'all'}
          onChange={setTenantFilter}
          clearable={false}
          style={{ minWidth: 160 }}
        />
        <Select
          placeholder="Filter by state"
          data={[
            { value: 'all', label: 'All states' },
            { value: 'pending', label: 'Pending' },
            { value: 'active', label: 'Active' },
            { value: 'deactivated', label: 'Deactivated' },
            { value: 'removed', label: 'Removed' },
          ]}
          value={stateFilter}
          onChange={(v) => { setStateFilter(v ?? 'all'); }}
          style={{ minWidth: 140 }}
        />
      </Group>

      {rows.length === 0 ? (
        <EmptyState
          icon={IconUsers}
          title="No users found"
          description="No users match the current filters."
        />
      ) : (
        <DataTable columns={columns} data={rows} />
      )}
    </Stack>
  );
}
