/**
 * <UserList> — DataTable list of users in a tenant.
 *
 * Stage-2 plan-02: backed by the real `useListUsers` hook. Filtering is
 * client-side over the page returned by the daemon (page size capped at 1000
 * by the API contract). Bulk row actions call the real lifecycle endpoints.
 */
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Select, TextInput, Group, Stack, Loader } from '@mantine/core';
import { IconSearch, IconUser, IconDownload } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { DataTable, type BulkAction } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { notify } from '@/hooks/use-notify';
import { useFilterUrlHandle } from '@/hooks/use-filter-url-handle';
import { useUserList, useUserMutations } from '../api';
import { MembershipActions } from './membership-actions';
import type { UserWithMembership, UserFilter } from '../types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
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
  const { filter, setFilter } = useFilterUrlHandle<UserFilter>(DEFAULT_FILTER);

  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

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

  void debouncedSearch;

  const { items: users, isLoading } = useUserList(tenantId, filter);
  const { deactivateMembership } = useUserMutations(tenantId);

  const usersRef = useRef<UserWithMembership[]>([]);
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const handleBulkDeactivate = useCallback(
    async (rowIds: string[]) => {
      const userIds = rowIds
        .map((id) => usersRef.current[Number(id)])
        .filter((u): u is UserWithMembership => u !== undefined)
        .filter((u) => u.membership.state === 'active')
        .map((u) => u.user.id);

      if (userIds.length === 0) {
        notify.warn('Nothing to do', 'No active users in the selection.');
        return;
      }

      let failed = 0;
      for (const uid of userIds) {
        try {
          await deactivateMembership(uid);
        } catch {
          failed++;
        }
      }
      const succeeded = userIds.length - failed;
      if (succeeded > 0) {
        notify.success(
          'Users deactivated',
          `${String(succeeded)} user${succeeded !== 1 ? 's' : ''} deactivated.`,
        );
      }
      if (failed > 0) {
        notify.error(
          'Some deactivations failed',
          `${String(failed)} user${failed !== 1 ? 's' : ''} could not be deactivated.`,
        );
      }
    },
    [deactivateMembership],
  );

  const handleBulkExportCsv = useCallback((rowIds: string[]) => {
    const selected = rowIds
      .map((id) => usersRef.current[Number(id)])
      .filter((u): u is UserWithMembership => u !== undefined);

    if (selected.length === 0) {
      notify.warn('Nothing to export', 'No users in the selection.');
      return;
    }

    const header = 'name,email,state,joined_at';
    const rows = selected.map((u) => {
      const name = `"${u.user.name.replace(/"/g, '""')}"`;
      const email = `"${u.user.email.replace(/"/g, '""')}"`;
      const state = u.membership.state;
      const joinedAt = u.membership.joined_at ?? '';
      return `${name},${email},${state},${joinedAt}`;
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify.success(
      'Export ready',
      `${String(selected.length)} user${selected.length !== 1 ? 's' : ''} exported.`,
    );
  }, []);

  const bulkActions = useMemo<BulkAction[]>(
    () => [
      {
        label: 'Export as CSV',
        color: 'teal',
        icon: IconDownload,
        onClick: (ids) => {
          handleBulkExportCsv(ids);
        },
      },
      {
        label: 'Deactivate selected',
        color: 'orange',
        onClick: (ids) => {
          void handleBulkDeactivate(ids);
        },
      },
    ],
    [handleBulkExportCsv, handleBulkDeactivate],
  );

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
              <Badge size="xs" color="red" variant="outline" data-testid="user-disabled-badge">
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
          <Text size="sm" c="var(--mantine-color-gray-7)">
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
            <Badge size="sm" color={STATE_COLORS[state] ?? 'gray'} variant="light">
              {state}
            </Badge>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 180,
        cell: ({ row }) => (
          <MembershipActions membership={row.original.membership} tenantSlug={tenantSlug} />
        ),
      },
    ],
    [tenantSlug],
  );

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end">
        <TextInput
          placeholder="Search name or email…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => {
            handleSearchChange(e.currentTarget.value);
          }}
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
        {isLoading && <Loader size="sm" />}
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
