/**
 * <CrossTenantUsers> — global user registry across all tenants.
 *
 * Features:
 *   - Filter by tenant membership, role, disabled status
 *   - Search by name or email
 *   - User detail drawer: Profile / Memberships across tenants / Audit-of-this-user
 *   - Admin audit emission when a user profile is viewed
 *
 * spec §8.1 §8.4 / Task 1d.78 / Plan 11
 */
import { useEffect, useMemo, useState } from 'react';
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
  Tabs,
  Box,
  SimpleGrid,
  Table,
  ScrollArea,
} from '@mantine/core';
import { IconSearch, IconUsers } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useMockStore } from '@/api/mock-store';
import { logAdminAuditEntry } from '@/api/resources/audit';
import type { Tenant, User, Membership, AuditEntry } from '@/api/resources';

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

// ─── User detail drawer ───────────────────────────────────────────────────────

function UserDetailDrawer({
  user,
}: {
  user: User | null;
}) {
  const memberships = useMockStore((s) => s.memberships);
  const tenants = useMockStore((s) => s.tenants);
  const auditEntries = useMockStore((s) => s.audit);
  const currentUserId = useMockStore((s) => s.currentUserId);

  const userMemberships = useMemo(() => {
    if (!user) return [];
    return Object.values(memberships)
      .filter((m) => m.user_id === user.id)
      .map((m) => ({ membership: m, tenant: tenants[m.tenant_id] }))
      .filter((r): r is { membership: Membership; tenant: Tenant } => r.tenant !== undefined);
  }, [memberships, tenants, user]);

  const userAuditEntries = useMemo((): AuditEntry[] => {
    if (!user) return [];
    return auditEntries
      .filter((e) => e.actor_id === user.id)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50);
  }, [auditEntries, user]);

  // Emit audit when drawer mounts (once per user open)
  useEffect(() => {
    if (!user) return;
    logAdminAuditEntry({
      tenant_id: null,
      actor_id: currentUserId ?? 'unknown',
      action: 'user:view',
      resource_type: 'user',
      resource_id: user.id,
      tier: 'read',
    }).catch(() => {
      // ignore — audit emission is best-effort
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) return null;

  return (
    <Tabs defaultValue="profile">
      <Tabs.List mb="md">
        <Tabs.Tab value="profile">Profile</Tabs.Tab>
        <Tabs.Tab value="memberships">Memberships ({userMemberships.length})</Tabs.Tab>
        <Tabs.Tab value="audit">Audit ({userAuditEntries.length})</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="profile">
        <SimpleGrid cols={2} spacing="xs">
          <Box>
            <Text size="xs" c="dimmed">
              Name
            </Text>
            <Text size="sm" fw={500}>
              {user.name}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Email
            </Text>
            <Text size="sm">{user.email}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Status
            </Text>
            <Badge color={user.disabled ? 'red' : 'green'} variant="light" size="sm">
              {user.disabled ? 'Disabled' : 'Active'}
            </Badge>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              TOTP
            </Text>
            <Badge
              color={user.totp_enrolled ? 'green' : 'gray'}
              variant="light"
              size="sm"
            >
              {user.totp_enrolled ? 'Enrolled' : 'Not enrolled'}
            </Badge>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Timezone
            </Text>
            <Text size="sm">{user.timezone}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Member since
            </Text>
            <Text size="sm">{new Date(user.created_at).toLocaleDateString()}</Text>
          </Box>
        </SimpleGrid>
      </Tabs.Panel>

      <Tabs.Panel value="memberships">
        <ScrollArea>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tenant</Table.Th>
                <Table.Th>State</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {userMemberships.map(({ membership, tenant }) => (
                <Table.Tr key={membership.id}>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {tenant.slug}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={STATE_COLORS[membership.state] ?? 'gray'}
                      variant="light"
                      size="sm"
                    >
                      {membership.state}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
              {userMemberships.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={2}>
                    <Text size="sm" c="dimmed" ta="center">
                      No memberships
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Tabs.Panel>

      <Tabs.Panel value="audit">
        <ScrollArea>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Action</Table.Th>
                <Table.Th>Resource</Table.Th>
                <Table.Th>Time</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {userAuditEntries.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>
                    <Badge variant="light" size="sm">
                      {e.action}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {e.resource_type}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {new Date(e.at).toLocaleString()}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
              {userAuditEntries.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={3}>
                    <Text size="sm" c="dimmed" ta="center">
                      No audit entries
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Tabs.Panel>
    </Tabs>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CrossTenantUsers() {
  const users = useMockStore((s) => s.users);
  const memberships = useMockStore((s) => s.memberships);
  const tenants = useMockStore((s) => s.tenants);

  const [tenantFilter, setTenantFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [disabledFilter, setDisabledFilter] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);
  const [detailUser, setDetailUser] = useState<User | null>(null);

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
        if (disabledFilter === 'disabled' && !r.user.disabled) return false;
        if (disabledFilter === 'active' && r.user.disabled) return false;
        return true;
      })
      .filter((r) => {
        if (!debouncedSearch) return true;
        const q = debouncedSearch.toLowerCase();
        return r.user.name.toLowerCase().includes(q) || r.user.email.toLowerCase().includes(q);
      });
  }, [memberships, users, tenants, tenantFilter, stateFilter, disabledFilter, debouncedSearch]);

  const columns: ColumnDef<CrossTenantUserRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (info) => (
        <Text
          size="sm"
          fw={500}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setDetailUser(info.row.original.user);
          }}
          data-testid="user-name-cell"
        >
          {info.row.original.user.name}
        </Text>
      ),
    },
    {
      id: 'email',
      header: 'Email',
      cell: (info) => (
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {info.row.original.user.email}
        </Text>
      ),
    },
    {
      id: 'tenant',
      header: 'Tenant',
      cell: (info) => (
        <Text size="sm" ff="monospace">
          {info.row.original.tenant.slug}
        </Text>
      ),
    },
    {
      id: 'disabled',
      header: 'Status',
      cell: (info) => (
        <Badge
          color={info.row.original.user.disabled ? 'red' : 'green'}
          variant="light"
          size="sm"
        >
          {info.row.original.user.disabled ? 'Disabled' : 'Active'}
        </Badge>
      ),
    },
    {
      id: 'state',
      header: 'Membership',
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
          onChange={(e) => {
            setSearchInput(e.currentTarget.value);
          }}
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
          onChange={(v) => {
            setStateFilter(v ?? 'all');
          }}
          style={{ minWidth: 140 }}
        />
        <Select
          placeholder="Filter by status"
          data={[
            { value: 'all', label: 'All users' },
            { value: 'active', label: 'Active only' },
            { value: 'disabled', label: 'Disabled only' },
          ]}
          value={disabledFilter}
          onChange={(v) => {
            setDisabledFilter(v ?? 'all');
          }}
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

      {/* User detail drawer */}
      <Drawer
        opened={detailUser !== null}
        onClose={() => {
          setDetailUser(null);
        }}
        title={detailUser ? `User: ${detailUser.name}` : 'User detail'}
        position="right"
        size="lg"
        padding="md"
      >
        <UserDetailDrawer user={detailUser} />
      </Drawer>
    </Stack>
  );
}
