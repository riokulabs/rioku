/**
 * <UserDetail> — detail drawer with four tabs:
 *   Profile | Memberships | Sessions | Effective permissions
 *
 * 1e.92 additions:
 *   - Disable / Re-enable user action (Profile tab)
 *   - Delete user action with typed email confirmation (Profile tab)
 *   - Impersonate button (Profile tab — super-admin only via user:impersonate perm)
 *   - Per-membership role edit (Memberships tab)
 *   - Pending-invite resend / revoke (Memberships tab)
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
  Modal,
  TextInput,
  MultiSelect,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconArrowsDiagonal,
  IconShieldHalf,
  IconUserSearch,
} from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { PermissionPathTrace } from '@/components/permission-path-trace';
import { EffectivePermissionsPanel } from '@/components/effective-permissions-panel';
import { usePermissionsCatalog } from '@/hooks/use-permissions-catalog';
import { usePermission } from '@/hooks/use-permission';
import { notify } from '@/hooks/use-notify';
import { useMockStore } from '@/api/mock-store';
import {
  useUserDetail,
  useUserSessions,
  revokeSession,
  disableUser,
  enableUser,
  deleteUser,
  resendInvite,
  revokeInvite,
  updateMembershipRoles,
} from '../api';
import { StatusBadge } from '@/components/status-badge';
import { Zone } from '@/components/zone';
import { MembershipActions } from './membership-actions';

const SAMPLE_PERMISSIONS = ['rioku.viewer.read', 'rioku.ops.read', 'rioku.admin.read'];

interface UserDetailProps {
  userId: string;
  currentTenantId: string;
  tenantSlug: string;
  onClose: () => void;
  /** Optional: navigate to the full-page detail view. */
  onOpenFullPage?: () => void;
}

export function UserDetail({
  userId,
  currentTenantId,
  tenantSlug,
  onClose,
  onOpenFullPage,
}: UserDetailProps) {
  const detail = useUserDetail(userId);
  const sessions = useUserSessions(userId);
  const tenants = useMockStore((s) => s.tenants);
  const currentUserId = useMockStore((s) => s.currentUserId);
  const roles = useMockStore((s) => s.roles);

  const [tracedPermission, setTracedPermission] = useState(SAMPLE_PERMISSIONS[0] ?? '');
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Delete modal
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [deleteEmailInput, setDeleteEmailInput] = useState('');

  // Disable modal
  const [disableOpened, { open: openDisable, close: closeDisable }] = useDisclosure(false);

  // Role edit state: membershipId → new role_ids
  const [editingRoles, setEditingRoles] = useState<Record<string, string[] | undefined>>({});

  // Invite resend result
  const [resendToken, setResendToken] = useState<Record<string, string>>({});

  const { all: allPerms } = usePermissionsCatalog();
  const permOptions = allPerms.map((p) => ({ value: p.key, label: p.key }));

  const canImpersonate = usePermission('user:impersonate');

  const navigate = useNavigate();

  if (!detail) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
        User not found.
      </Alert>
    );
  }

  const { user, memberships } = detail;

  const currentMembership = memberships.find((m) => m.tenant_id === currentTenantId);

  const isSelf = currentUserId === userId;

  // Role options for the MultiSelect
  const allRoleOptions = Object.values(roles)
    .filter((r) => r.tenant_id === currentTenantId)
    .map((r) => ({ value: r.id, label: r.name }));

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

  async function handleDisableConfirm() {
    setActionLoading(true);
    try {
      await disableUser(userId);
      notify.success('User disabled', 'The user cannot log in.');
      closeDisable();
    } catch {
      notify.error('Failed to disable user', 'Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleEnable() {
    setActionLoading(true);
    try {
      await enableUser(userId);
      notify.success('User enabled', 'The user can log in again.');
    } catch {
      notify.error('Failed to enable user', 'Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteConfirm() {
    if (deleteEmailInput !== user.email) return;
    setActionLoading(true);
    try {
      await deleteUser(userId);
      notify.success('User deleted', 'The user and all memberships have been removed.');
      closeDelete();
      onClose();
    } catch {
      notify.error('Failed to delete user', 'Please try again.');
    } finally {
      setActionLoading(false);
      setDeleteEmailInput('');
    }
  }

  async function handleResendInvite(membershipId: string) {
    setActionLoading(true);
    try {
      const result = await resendInvite(membershipId);
      setResendToken((prev) => ({ ...prev, [membershipId]: result.inviteToken }));
      notify.success('Invite resent', 'A new invite link has been generated.');
    } catch {
      notify.error('Failed to resend invite', 'Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevokeInvite(membershipId: string) {
    setActionLoading(true);
    try {
      await revokeInvite(membershipId);
      notify.success('Invite revoked', 'The pending invitation has been cancelled.');
    } catch {
      notify.error('Failed to revoke invite', 'Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveRoles(membershipId: string, newRoleIds: string[]) {
    setActionLoading(true);
    try {
      await updateMembershipRoles(membershipId, newRoleIds);
      setEditingRoles((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [membershipId]: _removed, ...rest } = prev;
        return rest;
      });
      notify.success('Roles updated', 'Membership roles have been saved.');
    } catch {
      notify.error('Failed to update roles', 'Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  function handleImpersonate() {
    void navigate({
      to: '/admin/impersonate',
      search: { user_id: userId, tenant_id: currentTenantId } as Record<string, string>,
    });
    onClose();
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Group gap="sm">
          <Avatar size="md" color="blue" radius="xl">
            {user.name.charAt(0).toUpperCase()}
          </Avatar>
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4}>{user.name}</Title>
              {user.disabled && (
                <StatusBadge kind="error" size="sm">
                  disabled
                </StatusBadge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              {user.email}
            </Text>
          </Stack>
        </Group>
        {onOpenFullPage && (
          <Tooltip label="Open full page" withArrow>
            <Button
              variant="subtle"
              size="xs"
              px={6}
              aria-label="Open full page"
              onClick={onOpenFullPage}
            >
              <IconArrowsDiagonal size={14} />
            </Button>
          </Tooltip>
        )}
      </Group>

      {/* Zone: service.detail.header-actions — plugins can add actions here */}
      <Zone id="service.detail.header-actions" />

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
                <StatusBadge kind="error" size="sm">
                  disabled
                </StatusBadge>
              ) : (
                <StatusBadge kind="active" size="sm">
                  enabled
                </StatusBadge>
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

            <Divider mt="sm" />

            {/* ── Actions ── */}
            <Stack gap="xs">
              <Text size="xs" fw={500} c="dimmed" tt="uppercase">
                Actions
              </Text>

              {/* Impersonate — only for super-admins viewing a non-self user */}
              {canImpersonate && !isSelf && (
                <Button
                  size="xs"
                  variant="light"
                  color="violet"
                  leftSection={<IconUserSearch size={14} />}
                  onClick={handleImpersonate}
                >
                  Impersonate user
                </Button>
              )}

              {/* Disable / Re-enable */}
              {!isSelf && !user.disabled && (
                <Button
                  size="xs"
                  variant="light"
                  color="orange"
                  loading={actionLoading}
                  onClick={openDisable}
                >
                  Disable user
                </Button>
              )}
              {!isSelf && user.disabled && (
                <Button
                  size="xs"
                  variant="light"
                  color="green"
                  loading={actionLoading}
                  onClick={() => void handleEnable()}
                >
                  Re-enable user
                </Button>
              )}

              {/* Delete */}
              {!isSelf && (
                <Button size="xs" variant="subtle" color="red" onClick={openDelete}>
                  Delete user…
                </Button>
              )}
            </Stack>
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
                .map((rid) => detail.roles[rid])
                .filter((r): r is NonNullable<typeof r> => r !== undefined);

              const isEditingRoles = editingRoles[m.id] !== undefined;
              const editRoleIds = editingRoles[m.id] ?? m.role_ids;
              const token = resendToken[m.id];

              return (
                <Stack key={m.id} gap="xs">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={2}>
                      <Text size="sm" fw={500}>
                        {tenant?.name ?? m.tenant_id}
                        {m.tenant_id === currentTenantId && (
                          <Badge ml="xs" size="xs" variant="outline" color="blue">
                            current
                          </Badge>
                        )}
                      </Text>

                      {/* Role edit inline */}
                      {m.tenant_id === currentTenantId && !isEditingRoles && (
                        <Text size="xs" c="dimmed">
                          Roles: {memberRoles.map((r) => r.name).join(', ') || '—'}
                        </Text>
                      )}
                      {m.tenant_id === currentTenantId && isEditingRoles && (
                        <Stack gap="xs" mt="xs">
                          <MultiSelect
                            size="xs"
                            label="Roles"
                            data={allRoleOptions}
                            value={editRoleIds}
                            onChange={(v) => {
                              setEditingRoles((prev) => ({ ...prev, [m.id]: v }));
                            }}
                            searchable
                          />
                          <Group gap="xs">
                            <Button
                              size="xs"
                              loading={actionLoading}
                              onClick={() => void handleSaveRoles(m.id, editRoleIds)}
                            >
                              Save roles
                            </Button>
                            <Button
                              size="xs"
                              variant="default"
                              onClick={() => {
                                setEditingRoles(({ [m.id]: _removed, ...rest }) => rest);
                              }}
                            >
                              Cancel
                            </Button>
                          </Group>
                        </Stack>
                      )}
                      {m.tenant_id !== currentTenantId && (
                        <Text size="xs" c="dimmed">
                          Roles: {memberRoles.map((r) => r.name).join(', ') || '—'}
                        </Text>
                      )}
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
                        <MembershipActions membership={m} tenantSlug={tenantSlug} />
                      )}

                      {/* Role edit toggle (current tenant only, non-pending) */}
                      {m.tenant_id === currentTenantId &&
                        m.state !== 'pending' &&
                        !isEditingRoles && (
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              setEditingRoles((prev) => ({ ...prev, [m.id]: m.role_ids }));
                            }}
                          >
                            Edit roles
                          </Button>
                        )}
                    </Group>
                  </Group>

                  {/* Pending invite actions */}
                  {m.state === 'pending' && m.tenant_id === currentTenantId && (
                    <Stack gap="xs">
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          color="blue"
                          loading={actionLoading}
                          onClick={() => void handleResendInvite(m.id)}
                        >
                          Resend invite
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          loading={actionLoading}
                          onClick={() => void handleRevokeInvite(m.id)}
                        >
                          Revoke invite
                        </Button>
                      </Group>
                      {token && (
                        <Alert color="blue" variant="light" p="xs">
                          <Text size="xs" ff="monospace">
                            Invite link (mock):{' '}
                            <Text component="span" fw={600}>
                              /auth/invite?token={token}
                            </Text>
                          </Text>
                        </Alert>
                      )}
                    </Stack>
                  )}

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
                      <Text size="xs">{new Date(sess.last_seen).toLocaleString()}</Text>
                    </Table.Td>
                    <Table.Td>
                      {sess.revoked ? (
                        <StatusBadge kind="error" size="xs">
                          revoked
                        </StatusBadge>
                      ) : (
                        <StatusBadge kind="active" size="xs">
                          active
                        </StatusBadge>
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
          <Tabs defaultValue="overview" variant="outline">
            <Tabs.List>
              <Tabs.Tab value="overview">Overview</Tabs.Tab>
              <Tabs.Tab value="trace">Trace permission</Tabs.Tab>
            </Tabs.List>

            {/* ── Overview: full computed set ── */}
            <Tabs.Panel value="overview" pt="md">
              <EffectivePermissionsPanel scope="user" id={userId} tenantId={currentTenantId} />
            </Tabs.Panel>

            {/* ── Trace: single-permission debugger ── */}
            <Tabs.Panel value="trace" pt="md">
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
        </Tabs.Panel>
      </Tabs>

      {/* ── Disable modal ── */}
      <Modal opened={disableOpened} onClose={closeDisable} title="Disable user" size="sm">
        <Stack gap="md">
          <Text size="sm">
            Disabling{' '}
            <Text component="span" fw={600}>
              {user.name}
            </Text>{' '}
            will prevent them from logging in across all tenants. Their data is preserved and the
            user can be re-enabled at any time.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" size="sm" onClick={closeDisable}>
              Cancel
            </Button>
            <Button
              color="orange"
              size="sm"
              loading={actionLoading}
              onClick={() => void handleDisableConfirm()}
            >
              Disable
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Delete modal ── */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteEmailInput('');
        }}
        title="Delete user"
        size="sm"
      >
        <Stack gap="md">
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            This permanently deletes the user. All memberships will be set to removed, all sessions
            revoked, and all API keys revoked. This action cannot be undone.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {user.email}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteEmailInput}
            onChange={(e) => {
              setDeleteEmailInput(e.currentTarget.value);
            }}
            placeholder={user.email}
            data-autofocus
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                closeDelete();
                setDeleteEmailInput('');
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              size="sm"
              loading={actionLoading}
              disabled={deleteEmailInput !== user.email}
              onClick={() => void handleDeleteConfirm()}
            >
              Delete user permanently
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
