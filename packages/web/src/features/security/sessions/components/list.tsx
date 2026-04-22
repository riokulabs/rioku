/**
 * <SessionList> — DataTable list of user sessions.
 *
 * Columns: device, IP, last-seen (relative), location, expires-at, current badge, revoke.
 */
import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Stack, Group, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDeviceDesktop, IconShield } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { notify } from '@/hooks/use-notify';
import { useSessionList, revokeSession } from '../api';
import { RevokeAllConfirm } from './revoke-confirm';
import type { SessionWithMeta } from '../types';

const PLACEHOLDER_CURRENT_SESSION = 'current-session-mock';

interface SessionListProps {
  /** Filter to this userId; defaults to currentUser */
  userId?: string;
  /** Filter to this tenantId */
  tenantId?: string;
}

export function SessionList({ userId, tenantId }: SessionListProps) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeAllOpened, { open: openRevokeAll, close: closeRevokeAll }] = useDisclosure(false);

  const sessions = useSessionList(userId, tenantId);

  async function handleRevoke(sessionId: string) {
    setRevokingId(sessionId);
    try {
      await revokeSession(sessionId);
      notify.success('Session revoked', 'The session has been signed out.');
    } catch {
      notify.error('Failed to revoke session', 'Please try again.');
    } finally {
      setRevokingId(null);
    }
  }

  const columns = useMemo<ColumnDef<SessionWithMeta>[]>(
    () => [
      {
        id: 'device',
        header: 'Device',
        accessorFn: (row) => row.device,
        cell: ({ getValue, row }) => (
          <Group gap="xs">
            <Text size="sm" fw={500}>
              {getValue<string>()}
            </Text>
            {row.original.is_current && (
              <Badge size="xs" color="blue" variant="filled">
                current
              </Badge>
            )}
          </Group>
        ),
      },
      {
        id: 'ip',
        header: 'IP',
        accessorFn: (row) => row.ip,
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'location',
        header: 'Location',
        accessorFn: (row) => row.location,
        cell: ({ getValue }) => (
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'last_seen',
        header: 'Last seen',
        accessorFn: (row) => row.last_seen_relative,
        cell: ({ getValue }) => <Text size="sm">{getValue<string>()}</Text>,
      },
      {
        id: 'expires_at',
        header: 'Expires',
        accessorFn: (row) => row.expires_at,
        cell: ({ getValue }) => {
          const val = getValue<string>();
          const d = new Date(val);
          const diff = d.getTime() - Date.now();
          const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
          return (
            <Text size="sm" c={days < 1 ? 'red' : days < 3 ? 'orange' : 'dimmed'}>
              {days < 1 ? 'Expired' : `${String(days)}d`}
            </Text>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        size: 90,
        accessorFn: (row) => row.revoked,
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <StatusBadge kind="error" size="sm">
              revoked
            </StatusBadge>
          ) : (
            <StatusBadge kind="active" size="sm">
              active
            </StatusBadge>
          ),
      },
      {
        id: 'actions',
        header: '',
        size: 100,
        cell: ({ row }) => {
          const sess = row.original;
          if (sess.revoked || sess.is_current) return null;
          return (
            <Button
              size="xs"
              variant="subtle"
              color="red.8"
              loading={revokingId === sess.id}
              onClick={() => void handleRevoke(sess.id)}
            >
              Revoke
            </Button>
          );
        },
      },
    ],
    [revokingId],
  );

  const activeSessions = sessions.filter((s) => !s.revoked);
  const hasOtherSessions = activeSessions.some((s) => !s.is_current);

  return (
    <Stack gap="sm">
      {hasOtherSessions && (
        <Group justify="flex-end">
          <Button size="sm" variant="light" color="red.8" onClick={openRevokeAll}>
            Revoke all other sessions
          </Button>
        </Group>
      )}

      <DataTable
        data={sessions}
        columns={columns}
        sorting
        pagination={{ pageSize: 20 }}
        urlSyncKey="sessions"
        emptyState={
          <EmptyState
            icon={IconDeviceDesktop}
            title="No sessions"
            description="No active sessions found"
          />
        }
        caption="Sessions"
      />

      <RevokeAllConfirm
        opened={revokeAllOpened}
        onClose={closeRevokeAll}
        currentSessionId={PLACEHOLDER_CURRENT_SESSION}
      />
    </Stack>
  );
}

// Re-export for convenience
export { IconShield };
