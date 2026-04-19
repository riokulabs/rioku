/**
 * <UserList> — DataTable list of users with membership states.
 *
 * Columns: name, email, membership state, roles (truncated), actions.
 * Filter controls: status dropdown + async name/email search via useOpaqueFilter.
 */
import { useMemo, useState, useCallback } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Badge,
  Text,
  Select,
  TextInput,
  Group,
  Stack,
} from '@mantine/core';
import { IconSearch, IconUser } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useOpaqueFilter } from '@/hooks/use-opaque-filter';
import { useMockStore } from '@/api/mock-store';
import { useUserList } from '../api';
import { MembershipActions } from './membership-actions';
import type { UserWithMembership, UserFilter } from '../types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'removed', label: 'Removed' },
];

const STATE_COLORS: Record<string, string> = {
  pending: 'yellow',
  active: 'green',
  deactivated: 'orange',
  removed: 'red',
};

const DEFAULT_FILTER: UserFilter = { search: '', status: 'all' };

interface UserListProps {
  tenantId: string;
  tenantSlug: string;
  onSelect: (item: UserWithMembership) => void;
}

export function UserList({ tenantId, tenantSlug, onSelect }: UserListProps) {
  // Opaque filter — search string never hits the URL
  const { filter, setFilter } = useOpaqueFilter<UserFilter>(DEFAULT_FILTER);

  // Local search input — debounced before writing to opaque filter
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  // Sync debounced search to opaque filter
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      setFilter({ ...filter, search: value });
    },
    [filter, setFilter],
  );

  const handleStatusChange = useCallback(
    (value: string | null) => {
      setFilter({ ...filter, status: (value ?? 'all') as UserFilter['status'] });
    },
    [filter, setFilter],
  );

  // Suppress debouncedSearch lint warning — it's used via handleSearchChange
  void debouncedSearch;

  const tenantData = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.id === tenantId),
  );

  const users = useUserList(tenantId, filter);

  const columns = useMemo<ColumnDef<UserWithMembership>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.user.name,
        cell: ({ getValue, row }) => (
          <Stack gap={0}>
            <Text size="sm" fw={500}>
              {getValue<string>()}
            </Text>
            {row.original.user.disabled && (
              <Badge size="xs" color="red" variant="outline">
                disabled
              </Badge>
            )}
          </Stack>
        ),
      },
      {
        id: 'email',
        header: 'Email',
        accessorFn: (row) => row.user.email,
        cell: ({ getValue }) => (
          <Text size="sm" c="dimmed">
            {getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'state',
        header: 'Status',
        size: 120,
        accessorFn: (row) => row.membership.state,
        cell: ({ getValue }) => {
          const state = getValue<string>();
          return (
            <Badge
              size="sm"
              color={STATE_COLORS[state] ?? 'gray'}
              variant="light"
            >
              {state}
            </Badge>
          );
        },
      },
      {
        id: 'roles',
        header: 'Roles',
        accessorFn: (row) => row.roles.map((r) => r.name).join(', '),
        cell: ({ getValue }) => {
          const val = getValue<string>();
          const truncated = val.length > 40 ? `${val.slice(0, 37)}…` : val;
          return (
            <Text size="sm" c="dimmed" title={val}>
              {truncated || '—'}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 180,
        cell: ({ row }) => (
          <MembershipActions
            membership={row.original.membership}
            tenantSlug={tenantData?.slug ?? tenantSlug}
          />
        ),
      },
    ],
    [tenantData, tenantSlug],
  );

  return (
    <Stack gap="sm">
      {/* Filter controls */}
      <Group gap="sm" align="flex-end">
        <TextInput
          placeholder="Search name or email…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => { handleSearchChange(e.currentTarget.value); }}
          style={{ flex: 1 }}
          aria-label="Search users by name or email"
        />
        <Select
          data={STATUS_OPTIONS}
          value={filter.status}
          onChange={handleStatusChange}
          w={160}
          aria-label="Filter by membership status"
        />
      </Group>

      <DataTable
        data={users}
        columns={columns}
        sorting
        pagination={{ pageSize: 20 }}
        urlSyncKey="users"
        onRowClick={onSelect}
        emptyState={
          <EmptyState
            icon={IconUser}
            title="No users yet"
            description="No users yet — invite your first user"
          />
        }
        caption="Users"
      />
    </Stack>
  );
}
