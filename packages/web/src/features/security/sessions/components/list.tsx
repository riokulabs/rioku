/**
 * <SessionList> — inline list of the principal's active sessions.
 *
 * RD5 contract: sessions render inline. There is no detail drawer and
 * no full-page detail view — every session is visible directly with
 * its device fingerprint, IP, last-active timestamp, and a per-row
 * Revoke action. A page-level "Revoke all other sessions" button
 * triggers the bulk endpoint.
 */
import { useCallback, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Stack, Group, Button, Alert } from '@mantine/core';
import { IconAlertCircle, IconDeviceDesktop } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { notify } from '@/hooks/use-notify';
import { useSessionList, useSessionMutations } from '../api';
import type { SessionWithMeta } from '../types';

interface SessionListProps {
  /** Tenant slug — required for the daemon-scoped path. */
  tenant: string;
  /**
   * Optional id of "this" session. When provided, that row is badged
   * "current" and its Revoke button is hidden so the user can never
   * sign themselves out from this surface.
   */
  currentSessionId?: string | null;
}

export function SessionList({ tenant, currentSessionId = null }: SessionListProps) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const { sessions, isLoading, isError } = useSessionList(tenant, currentSessionId);
  const { revokeSession, revokeAllOtherSessions } = useSessionMutations(tenant);

  const handleRevoke = useCallback(
    async (sessionId: string) => {
      setRevokingId(sessionId);
      try {
        await revokeSession(sessionId);
        notify.success('Session revoked', 'The session has been signed out.');
      } catch {
        notify.error('Failed to revoke session', 'Please try again.');
      } finally {
        setRevokingId(null);
      }
    },
    [revokeSession],
  );

  async function handleRevokeAll() {
    setRevokingAll(true);
    try {
      await revokeAllOtherSessions();
      notify.success(
        'Sessions revoked',
        'All other active sessions have been signed out. You remain logged in.',
      );
    } catch {
      notify.error('Failed to revoke sessions', 'Please try again.');
    } finally {
      setRevokingAll(false);
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
            <IconDeviceDesktop size={14} color="var(--mantine-color-gray-6)" />
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
            {getValue<string>() || '—'}
          </Text>
        ),
      },
      {
        id: 'last_seen',
        header: 'Last active',
        accessorFn: (row) => row.last_seen_relative,
        cell: ({ getValue }) => <Text size="sm">{getValue<string>()}</Text>,
      },
      {
        id: 'status',
        header: 'Status',
        size: 100,
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
              data-testid={`revoke-${sess.id}`}
            >
              Revoke
            </Button>
          );
        },
      },
    ],
    [revokingId, handleRevoke],
  );

  const activeSessions = sessions.filter((s) => !s.revoked);
  const hasOtherSessions = activeSessions.some((s) => !s.is_current);

  return (
    <Stack gap="sm">
      {isError && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          Failed to load sessions. Please refresh the page.
        </Alert>
      )}

      {hasOtherSessions && (
        <Group justify="flex-end">
          <Button
            size="sm"
            variant="light"
            color="red.8"
            loading={revokingAll}
            onClick={() => void handleRevokeAll()}
            data-testid="revoke-all-others"
          >
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
            title={isLoading ? 'Loading sessions…' : 'No sessions'}
            description={
              isLoading ? 'Fetching active sessions from the daemon.' : 'No active sessions found.'
            }
          />
        }
        caption="Sessions"
      />
    </Stack>
  );
}
