/**
 * <UserDetail> — detail drawer with four tabs:
 *   Profile | Memberships | Sessions | Effective permissions
 */
import { useState } from 'react';
import {
  Stack,
  Group,
  Title,
  Text,
  Badge,
  Button,
  Divider,
  Tabs,
  Avatar,
  Table,
  Select,
  Alert,
} from '@mantine/core';
import { IconAlertCircle, IconShieldHalf } from '@tabler/icons-react';
import { PermissionPathTrace } from '@/components/permission-path-trace';
import { usePermissionsCatalog } from '@/hooks/use-permissions-catalog';
import { notify } from '@/hooks/use-notify';
import { useMockStore } from '@/api/mock-store';
import { useUserDetail, useUserSessions, revokeSession } from '../api';
import { MembershipActions } from './membership-actions';

const SAMPLE_PERMISSIONS = [
  'rioku.viewer.read',
  'rioku.ops.read',
  'rioku.admin.read',
];

interface UserDetailProps {
  userId: string;
  currentTenantId: string;
  tenantSlug: string;
  onClose: () => void;
}

export function UserDetail({
  userId,
  currentTenantId,
  tenantSlug,
  onClose,
}: UserDetailProps) {
  const detail = useUserDetail(userId);
  const sessions = useUserSessions(userId);
  const tenants = useMockStore((s) => s.tenants);

  const [tracedPermission, setTracedPermission] = useState(SAMPLE_PERMISSIONS[0] ?? '');
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  const { all: allPerms } = usePermissionsCatalog();
  const permOptions = allPerms.map((p) => ({ value: p.key, label: p.key }));

  if (!detail) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
        User not found.
      </Alert>
    );
  }

  const { user, memberships, roles } = detail;

  const currentMembership = memberships.find(
    (m) => m.tenant_id === currentTenantId,
  );

  async function handleRevokeSession(sessionId: string) {
    setRevokingSessionId(sessionId);
    try {
      await revokeSession(sessionId);
      notify.success('Session revoked', 'The session has been invalidated.');
    } catch {
      notify.error('Failed to revoke session', 'Please try again.');
    } finally {
      setRevokingSessionId(null);
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Group gap="sm">
          <Avatar size="md" color="blue" radius="xl">
            {user.name.charAt(0).toUpperCase()}
          </Avatar>
          <Stack gap={2}>
            <Title order={4}>{user.name}</Title>
            <Text size="sm" c="dimmed">
              {user.email}
            </Text>
          </Stack>
        </Group>
        <Button size="xs" variant="default" onClick={onClose}>
          Close
        </Button>
      </Group>

      <Divider />

      <Tabs defaultValue="profile">
        <Tabs.List>
          <Tabs.Tab value="profile">Profile</Tabs.Tab>
          <Tabs.Tab value="memberships">Memberships</Tabs.Tab>
          <Tabs.Tab value="sessions">Sessions</Tabs.Tab>
          <Tabs.Tab value="permissions" leftSection={<IconShieldHalf size={14} />}>
            Effective Perms
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Profile ── */}
        <Tabs.Panel value="profile" pt="md">
          <Stack gap="sm">
            <Group gap="xs">
              <Text size="sm" fw={500} w={120}>
                Email:
              </Text>
              <Text size="sm">{user.email}</Text>
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={500} w={120}>
                Name:
              </Text>
              <Text size="sm">{user.name}</Text>
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={500} w={120}>
                Status:
              </Text>
              {user.disabled ? (
                <Badge color="red" size="sm">
                  disabled
                </Badge>
              ) : (
                <Badge color="green" size="sm">
                  enabled
                </Badge>
              )}
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={500} w={120}>
                TOTP:
              </Text>
              <Badge color={user.totp_enabled ? 'green' : 'gray'} size="sm" variant="outline">
                {user.totp_enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={500} w={120}>
                Created:
              </Text>
              <Text size="sm">{new Date(user.created_at).toLocaleDateString()}</Text>
            </Group>
          </Stack>
        </Tabs.Panel>

        {/* ── Memberships ── */}
        <Tabs.Panel value="memberships" pt="md">
          <Stack gap="md">
            {memberships.length === 0 && (
              <Text size="sm" c="dimmed">
                No memberships found.
              </Text>
            )}
            {memberships.map((m) => {
              const tenant = tenants[m.tenant_id];
              const memberRoles = m.role_ids
                .map((rid) => roles[rid])
                .filter((r): r is NonNullable<typeof r> => r !== undefined);

              return (
                <Stack key={m.id} gap="xs">
                  <Group justify="space-between" align="center">
                    <Stack gap={2}>
                      <Text size="sm" fw={500}>
                        {tenant?.name ?? m.tenant_id}
                        {m.tenant_id === currentTenantId && (
                          <Badge ml="xs" size="xs" variant="outline" color="blue">
                            current
                          </Badge>
                        )}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Roles: {memberRoles.map((r) => r.name).join(', ') || '—'}
                      </Text>
                    </Stack>
                    <Group gap="xs" align="center">
                      <Badge
                        size="sm"
                        color={
                          m.state === 'active'
                            ? 'green'
                            : m.state === 'pending'
                              ? 'yellow'
                              : m.state === 'deactivated'
                                ? 'orange'
                                : 'red'
                        }
                        variant="light"
                      >
                        {m.state}
                      </Badge>
                      {m.tenant_id === currentTenantId && (
                        <MembershipActions
                          membership={m}
                          tenantSlug={tenantSlug}
                        />
                      )}
                    </Group>
                  </Group>
                  <Divider />
                </Stack>
              );
            })}
            {currentMembership && (
              <Text size="xs" c="dimmed">
                Member since{' '}
                {currentMembership.joined_at
                  ? new Date(currentMembership.joined_at).toLocaleDateString()
                  : 'pending join'}
              </Text>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ── Sessions ── */}
        <Tabs.Panel value="sessions" pt="md">
          <Stack gap="sm">
            {sessions.length === 0 && (
              <Text size="sm" c="dimmed">
                No sessions found.
              </Text>
            )}
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>IP</Table.Th>
                  <Table.Th>User Agent</Table.Th>
                  <Table.Th>Last Seen</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sessions.map((sess) => (
                  <Table.Tr key={sess.id}>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {sess.ip}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" lineClamp={1} title={sess.user_agent}>
                        {sess.user_agent}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {new Date(sess.last_seen).toLocaleString()}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {sess.revoked ? (
                        <Badge size="xs" color="red">
                          revoked
                        </Badge>
                      ) : (
                        <Badge size="xs" color="green">
                          active
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {!sess.revoked && (
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          loading={revokingSessionId === sess.id}
                          onClick={() => void handleRevokeSession(sess.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Tabs.Panel>

        {/* ── Effective permissions ── */}
        <Tabs.Panel value="permissions" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Trace why this user has (or doesn&apos;t have) a specific permission.
            </Text>
            <Select
              label="Permission to trace"
              data={permOptions.length > 0 ? permOptions : SAMPLE_PERMISSIONS}
              value={tracedPermission}
              onChange={(v) => {
                if (v) setTracedPermission(v);
              }}
              searchable
            />
            <PermissionPathTrace
              userId={userId}
              tenantId={currentTenantId}
              permission={tracedPermission}
            />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
