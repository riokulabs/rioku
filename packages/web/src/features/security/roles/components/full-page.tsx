/**
 * <RoleFullPage> — dedicated full-screen role view.
 *
 * Tabs:
 *   1. Overview      — name, description, source badge, permission grants.
 *   2. Members       — table of users currently assigned this role.
 *   3. Effective     — joined permission preview via <EffectivePermissionsPanel>.
 *
 * Reads via the real-API hooks (`useRole` / `useListUsers` /
 * `useListUserRoles`) — no mock store.
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Stack, Group, Title, Text, Badge, Tabs, Paper, Table, Loader, Alert } from '@mantine/core';
import { IconAlertCircle, IconShieldHalf, IconUsers } from '@tabler/icons-react';
import { EffectivePermissionsPanel } from '@/components/effective-permissions-panel';
import { listUserRoles, getListUserRolesQueryKey } from '@/api/generated/roles/roles';
import { useListUsers } from '@/api/generated/users/users';
import { useListPermissions } from '@/api/generated/permissions/permissions';
import type { Permission as GenPermission } from '@/api/generated/schemas';
import { useRole } from '../api';

interface RoleFullPageProps {
  tenant: string;
  roleId: string;
}

interface MemberRow {
  id: string;
  email: string;
  name: string;
}

export function RoleFullPage({ tenant, roleId }: RoleFullPageProps) {
  const role = useRole(tenant, roleId);
  const usersQuery = useListUsers(tenant);
  const catalogQuery = useListPermissions(tenant);
  const catalog: GenPermission[] = catalogQuery.data?.data.permissions ?? [];

  const userList = useMemo(() => usersQuery.data?.data.users ?? [], [usersQuery.data]);

  const roleQueries = useQueries({
    queries: userList.map((u) => ({
      queryKey: getListUserRolesQueryKey(tenant, u.id ?? ''),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        listUserRoles(tenant, u.id ?? '', signal !== undefined ? { signal } : undefined),
      enabled: tenant !== '' && (u.id ?? '') !== '',
    })),
  });

  const members: MemberRow[] = useMemo(() => {
    const rows: MemberRow[] = [];
    userList.forEach((user, idx) => {
      const result = roleQueries[idx];
      const roles = result?.data?.data.roles ?? [];
      if (roles.some((r) => r.id === roleId)) {
        rows.push({
          id: user.id ?? '',
          email: user.email ?? '',
          name: user.name ?? user.email ?? '',
        });
      }
    });
    return rows;
  }, [userList, roleQueries, roleId]);

  if (!role) {
    return (
      <Stack p="md" gap="xs" align="flex-start">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          Loading role…
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md" p="md" data-testid="role-full-page">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs" align="center">
            <IconShieldHalf size={20} />
            <Title order={2}>{role.name}</Title>
          </Group>
          <Group gap="xs">
            {role.system && (
              <Badge color="gray" variant="outline" size="sm">
                system
              </Badge>
            )}
            <Badge color="blue" variant="light" size="sm">
              {role.grants.length} permission{role.grants.length !== 1 ? 's' : ''}
            </Badge>
          </Group>
        </Stack>
      </Group>

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="members" leftSection={<IconUsers size={14} />}>
            Members ({members.length})
          </Tabs.Tab>
          <Tabs.Tab value="effective">Effective Permissions</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Paper withBorder p="md" radius="sm">
            <Stack gap="sm">
              <Text size="sm" fw={500}>
                Granted permissions
              </Text>
              {role.grants.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No direct grants on this role.
                </Text>
              ) : (
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Permission</Table.Th>
                      <Table.Th>Source</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {role.grants.map((g) => {
                      const matched = catalog.find((p) => (p.id ?? '') === g.permission);
                      const isOrphan = !matched;
                      return (
                        <Table.Tr key={g.permission}>
                          <Table.Td>
                            <Text size="sm" ff="monospace">
                              {g.permission}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {isOrphan ? (
                              <Badge
                                color="red"
                                variant="light"
                                size="sm"
                                data-testid="grant-orphan-alert"
                              >
                                ORPHANED
                              </Badge>
                            ) : (
                              <Badge
                                color={
                                  matched.source === 'built-in'
                                    ? 'gray'
                                    : matched.source === 'plugin-manifest'
                                      ? 'blue'
                                      : 'violet'
                                }
                                variant="light"
                                size="sm"
                                data-testid="grant-source-badge"
                              >
                                {matched.source ?? 'unknown'}
                              </Badge>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="members" pt="md">
          <Paper withBorder p="md" radius="sm">
            {members.length === 0 ? (
              <Stack align="center" gap="xs" py="md">
                <IconUsers size={28} stroke={1.4} />
                <Text size="sm" c="dimmed">
                  No users currently hold this role.
                </Text>
              </Stack>
            ) : (
              <Table data-testid="role-members-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Email</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {members.map((m) => (
                    <Table.Tr key={m.id}>
                      <Table.Td>{m.name}</Table.Td>
                      <Table.Td>{m.email}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="effective" pt="md">
          <Paper withBorder p="md" radius="sm">
            <Stack gap="xs">
              <Text size="sm" c="var(--mantine-color-gray-7)">
                Full set of permissions this role effectively grants (own grants + inherited from
                parents).
              </Text>
              {role.parent_ids.length === 0 && role.grants.length === 0 && (
                <Alert color="gray" variant="light" icon={<IconAlertCircle size={14} />}>
                  This role has no direct grants and no parent roles — its effective permission set
                  is empty.
                </Alert>
              )}
              <EffectivePermissionsPanel scope="role" id={roleId} />
            </Stack>
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
