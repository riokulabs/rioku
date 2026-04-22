/**
 * <SessionDetail> — drawer content for a single session.
 *
 * Sections:
 *   - Header: device name, current-session badge, status chip
 *   - Details: full user-agent string, IP, geo-stub location, last seen
 *     (absolute + relative), expires-at, tenant
 *   - Actions: Revoke session button (disabled for current session or already
 *     revoked), closes the drawer on success
 */
import { useState } from 'react';
import { Alert, Badge, Button, Divider, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconDeviceDesktop, IconShieldLock } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { notify } from '@/hooks/use-notify';
import { StatusBadge } from '@/components/status-badge';
import { revokeSession } from '../api';
import type { SessionWithMeta } from '../types';

dayjs.extend(relativeTime);

interface SessionDetailProps {
  session: SessionWithMeta;
  onClose: () => void;
}

export function SessionDetail({ session, onClose }: SessionDetailProps) {
  const [revoking, setRevoking] = useState(false);

  const canRevoke = !session.revoked && !session.is_current;
  const absoluteLastSeen = dayjs(session.last_seen).format('YYYY-MM-DD HH:mm:ss');
  const absoluteExpires = dayjs(session.expires_at).format('YYYY-MM-DD HH:mm:ss');
  const expiresFromNow = dayjs(session.expires_at).fromNow();

  async function handleRevoke() {
    setRevoking(true);
    try {
      await revokeSession(session.id);
      notify.success('Session revoked', 'The session has been signed out.');
      onClose();
    } catch {
      notify.error('Failed to revoke session', 'Please try again.');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Stack gap="md" data-testid="session-detail">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconDeviceDesktop size={24} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4}>{session.device}</Title>
              {session.is_current && (
                <Badge size="sm" color="blue" variant="filled">
                  current
                </Badge>
              )}
              {session.revoked ? (
                <StatusBadge kind="error" size="sm">
                  revoked
                </StatusBadge>
              ) : (
                <StatusBadge kind="active" size="sm">
                  active
                </StatusBadge>
              )}
            </Group>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              {session.location}
            </Text>
          </Stack>
        </Group>
        <IconShieldLock size={18} color="var(--mantine-color-gray-6)" />
      </Group>

      <Divider />

      {/* Detail fields */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Session details
        </Text>

        <Group gap="xs">
          <Text size="xs" fw={500} w={120}>
            IP address
          </Text>
          <Text size="xs" ff="monospace">
            {session.ip}
          </Text>
        </Group>

        <Group gap="xs">
          <Text size="xs" fw={500} w={120}>
            Location
          </Text>
          <Text size="xs">{session.location}</Text>
        </Group>

        <Group gap="xs">
          <Text size="xs" fw={500} w={120}>
            Last seen
          </Text>
          <Text size="xs">
            {session.last_seen_relative}{' '}
            <Text component="span" size="xs" c="var(--mantine-color-gray-7)">
              ({absoluteLastSeen})
            </Text>
          </Text>
        </Group>

        <Group gap="xs">
          <Text size="xs" fw={500} w={120}>
            Expires
          </Text>
          <Text size="xs">
            {expiresFromNow}{' '}
            <Text component="span" size="xs" c="var(--mantine-color-gray-7)">
              ({absoluteExpires})
            </Text>
          </Text>
        </Group>
      </Stack>

      <Divider />

      {/* Full user-agent */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          User agent
        </Text>
        <Text
          size="xs"
          ff="monospace"
          style={{ wordBreak: 'break-all' }}
          c="var(--mantine-color-gray-7)"
        >
          {session.user_agent}
        </Text>
      </Stack>

      <Divider />

      {/* Actions */}
      {session.is_current && (
        <Alert color="blue" variant="light" icon={<IconAlertCircle size={16} />}>
          This is your current session — it cannot be revoked here.
        </Alert>
      )}

      {!session.is_current && (
        <Group gap="sm">
          <Button
            size="sm"
            variant="subtle"
            color="red.8"
            loading={revoking}
            disabled={!canRevoke}
            onClick={() => void handleRevoke()}
          >
            Revoke session
          </Button>
        </Group>
      )}
    </Stack>
  );
}
