/**
 * <UserList> — DataTable list of users with membership states.
 *
 * Columns: name, email, membership state, roles (truncated), actions.
 * Filter controls: status dropdown + async name/email search via useOpaqueFilter.
 */
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
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
import { DataTable, type BulkAction } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { notify } from '@/hooks/use-notify';
import { useOpaqueFilter } from '@/hooks/use-opaque-filter';
import { useMockStore } from '@/api/mock-store';
import { useUserList, deactivateMembership } from '../api';
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

  // Keep a stable ref to the current users array so bulk handlers can map
  // row indices (TanStack Table default row IDs) back to membership IDs.
  // Updating via useEffect avoids mutating a ref during render.
  const usersRef = useRef<UserWithMembership[]>([]);
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const handleBulkDeactivate = useCallback(async (rowIds: string[]) => {
    const memberships = rowIds
      .map((id) => usersRef.current[Number(id)])
      .filter((u): u is UserWithMembership => u !== undefined)
      .filter((u) => u.membership.state === 'active')
      .map((u) => u.membership.id);

    if (memberships.length === 0) {
      notify.warn('Nothing to do', 'No active memberships in the selection.');
      return;
    }

    let failed = 0;
    for (const mid of memberships) {
      try {
        await deactivateMembership(mid);
      } catch {
        failed++;
      }
    }
    const succeeded = memberships.length - failed;
    if (succeeded > 0) {
      notify.success(
        'Memberships deactivated',
        `${String(succeeded)} membership${succeeded !== 1 ? 's' : ''} deactivated.`,
      );
    }
    if (failed > 0) {
      notify.error(
        'Some deactivations failed',
        `${String(failed)} membership${failed !== 1 ? 's' : ''} could not be deactivated.`,
      );
    }
  }, []);

  const bulkActions = useMemo<BulkAction[]>(() => [
    {
      label: 'Deactivate selected',
      color: 'orange',
      onClick: (ids) => { void handleBulkDeactivate(ids); },
    },
  ], [handleBulkDeactivate]);

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
        rowSelection="multiple"
        bulkActions={bulkActions}
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
