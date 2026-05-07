/**
 * <UserDrawer> — quick-info drawer with a single revoke action and a link
 * to the full-page view.
 *
 * Used as the row-click target on the users list. Shows email/name/status
 * plus the most recent active session (if any) so an operator can revoke
 * without leaving the list. For deeper editing, click "Open full page".
 */
import { Stack, Group, Title, Text, Button, Avatar, Divider, Loader, Alert } from '@mantine/core';
import { IconAlertCircle, IconExternalLink } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { notify } from '@/hooks/use-notify';
import { StatusBadge } from '@/components/status-badge';
import { useUserDetail, useUserSessions, useUserMutations } from '../api';

interface UserDrawerProps {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  onClose: () => void;
}

export function UserDrawer({ userId, tenantId, tenantSlug, onClose }: UserDrawerProps) {
  const { detail, isLoading } = useUserDetail(tenantId, userId);
  const { sessions } = useUserSessions(tenantId, userId);
  const { revokeSession } = useUserMutations(tenantId);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }

  if (!detail) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
        User not found.
      </Alert>
    );
  }

  const { user } = detail;
  const activeSessions = sessions.filter((s) => !s.revoked);

  function openFullPage() {
    void navigate({
      to: '/t/$tenant/security/users/$userId',
      params: { tenant: tenantSlug, userId },
    } as unknown as Parameters<typeof navigate>[0]);
    onClose();
  }

  async function handleRevokeAll() {
    let failed = 0;
    for (const s of activeSessions) {
      try {
        await revokeSession(s.id, userId);
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      notify.error(
        'Revoke partial',
        `${String(failed)}/${String(activeSessions.length)} sessions could not be revoked.`,
      );
    } else {
      notify.success(
        'Sessions revoked',
        `${String(activeSessions.length)} session${activeSessions.length !== 1 ? 's' : ''} revoked.`,
      );
    }
  }

  return (
    <Stack gap="md">
      <Group gap="sm" align="flex-start">
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
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {user.email}
          </Text>
        </Stack>
      </Group>

      <Divider />

      <Stack gap="xs">
        <Text size="xs" fw={500} c="var(--mantine-color-gray-7)" tt="uppercase">
          Active sessions
        </Text>
        <Text size="sm">
          {activeSessions.length === 0
            ? 'No active sessions.'
            : `${String(activeSessions.length)} active session${activeSessions.length !== 1 ? 's' : ''}.`}
        </Text>
        {activeSessions.length > 0 && (
          <Button
            size="xs"
            variant="light"
            color="red.8"
            onClick={() => void handleRevokeAll()}
            data-testid="user-drawer-revoke-all"
          >
            Revoke all sessions
          </Button>
        )}
      </Stack>

      <Divider />

      <Group justify="flex-end" gap="sm">
        <Button variant="default" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          size="sm"
          leftSection={<IconExternalLink size={14} />}
          onClick={openFullPage}
          data-testid="user-drawer-open-full"
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}
