/**
 * <CrossTenantUsers> — global user registry across all tenants.
 *
 * Plan 11 close-out: now consumes the real `/api/v1/admin/users` endpoint via
 * `useListAdminUsers`. The daemon currently returns `{id, username, status}`
 * per user; richer per-user detail (memberships, audit) lands as a follow-up
 * endpoint. The detail drawer shows the fields the daemon returns today.
 *
 * Features:
 *   - Search by username
 *   - Filter by status (active / disabled)
 *   - User detail drawer with profile fields
 *
 * spec §8.1 §8.4 / Task 1d.78 / Plan 11
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
  Drawer,
  Box,
  SimpleGrid,
  Loader,
  Alert,
} from '@mantine/core';
import { IconSearch, IconUsers, IconAlertTriangle } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useListAdminUsers } from '@/api/generated/admin/admin';
import type { ListAdminUsers200ItemsItem } from '@/api/generated/schemas';

type AdminUser = ListAdminUsers200ItemsItem;

const STATUS_COLORS: Record<string, string> = {
  active: 'green',
  enabled: 'green',
  disabled: 'red',
  pending: 'yellow',
  removed: 'gray',
};

// ─── User detail drawer ───────────────────────────────────────────────────────

function UserDetailDrawer({ user }: { user: AdminUser | null }) {
  if (!user) return null;
  return (
    <Stack gap="md">
      <SimpleGrid cols={2} spacing="xs">
        <Box>
          <Text size="xs" c="dimmed">
            ID
          </Text>
          <Text size="sm" ff="monospace">
            {user.id ?? '—'}
          </Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            Username
          </Text>
          <Text size="sm" fw={500}>
            {user.username ?? '—'}
          </Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            Status
          </Text>
          <Badge color={STATUS_COLORS[user.status ?? ''] ?? 'gray'} variant="light" size="sm">
            {user.status ?? 'unknown'}
          </Badge>
        </Box>
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        Detailed cross-tenant memberships and per-user audit are exposed via the per-user admin
        endpoint that lands with the next sprint.
      </Text>
    </Stack>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CrossTenantUsers() {
  const { data, isLoading, isError, error } = useListAdminUsers();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);
  const [detailUser, setDetailUser] = useState<AdminUser | null>(null);

  const users = useMemo<AdminUser[]>(() => data?.data.items ?? [], [data]);

  const rows = useMemo((): AdminUser[] => {
    return users.filter((u) => {
      if (statusFilter === 'active' && u.status === 'disabled') return false;
      if (statusFilter === 'disabled' && u.status !== 'disabled') return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        if (!(u.username ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [users, statusFilter, debouncedSearch]);

  const columns: ColumnDef<AdminUser>[] = [
    {
      id: 'username',
      header: 'Username',
      cell: (info) => (
        <Text
          size="sm"
          fw={500}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setDetailUser(info.row.original);
          }}
          data-testid="user-name-cell"
        >
          {info.row.original.username ?? '—'}
        </Text>
      ),
    },
    {
      id: 'id',
      header: 'ID',
      cell: (info) => (
        <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
          {info.row.original.id ?? '—'}
        </Text>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (info) => (
        <Badge
          color={STATUS_COLORS[info.row.original.status ?? ''] ?? 'gray'}
          variant="light"
          size="sm"
        >
          {info.row.original.status ?? 'unknown'}
        </Badge>
      ),
    },
  ];

  return (
    <Stack gap="md" p="md">
      <Title order={2}>All users</Title>

      <Group gap="sm">
        <TextInput
          placeholder="Search by username…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.currentTarget.value);
          }}
          style={{ flex: 1 }}
          data-testid="user-search"
        />
        <Select
          placeholder="Filter by status"
          data={[
            { value: 'all', label: 'All users' },
            { value: 'active', label: 'Active only' },
            { value: 'disabled', label: 'Disabled only' },
          ]}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v ?? 'all');
          }}
          style={{ minWidth: 140 }}
          data-testid="status-filter"
        />
      </Group>

      {isLoading ? (
        <Group justify="center" p="xl">
          <Loader data-testid="user-list-loading" />
        </Group>
      ) : isError ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed to load users">
          {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={IconUsers}
          title="No users found"
          description="No users match the current filters."
        />
      ) : (
        <DataTable columns={columns} data={rows} />
      )}

      {/* User detail drawer */}
      <Drawer
        opened={detailUser !== null}
        onClose={() => {
          setDetailUser(null);
        }}
        title={detailUser ? `User: ${detailUser.username ?? detailUser.id ?? ''}` : 'User detail'}
        position="right"
        size="lg"
        padding="md"
      >
        <UserDetailDrawer user={detailUser} />
      </Drawer>
    </Stack>
  );
}
