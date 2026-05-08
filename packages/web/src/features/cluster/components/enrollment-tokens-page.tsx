/**
 * <EnrollmentTokensPage> — manage cluster enrollment tokens at
 * /t/$tenant/cluster/enrollment-tokens.
 *
 * Lists all tokens (active, expired, consumed). Generate new tokens via the
 * <EnrollModal>; revoke active ones inline. Generate is gated by
 * cluster:enroll; revoke uses cluster:enroll for symmetry with the daemon
 * route guard (see webhooks_cluster_impersonation_routes.go).
 */
import { useState, useMemo } from 'react';
import {
  Stack,
  Title,
  Group,
  Button,
  Text,
  Table,
  Badge,
  ActionIcon,
  Tooltip,
  Alert,
  Loader,
  Switch,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconRefresh, IconAlertCircle } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useEnrollmentTokens, revokeEnrollmentToken } from '../api';
import { EnrollModal } from './enroll-modal';
import type { ClusterEnrollmentToken } from '../types';

dayjs.extend(relativeTime);

type TokenState = 'active' | 'consumed' | 'expired';

function tokenState(t: ClusterEnrollmentToken): TokenState {
  if (t.consumed_by_node_id) return 'consumed';
  if (new Date(t.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

function stateColor(state: TokenState): string {
  switch (state) {
    case 'active':
      return 'teal';
    case 'consumed':
      return 'blue';
    case 'expired':
      return 'gray';
  }
}

export function EnrollmentTokensPage() {
  const tokens = useEnrollmentTokens();
  const canEnroll = usePermission('cluster:enroll');

  const [enrollOpened, { open: openEnroll, close: closeEnroll }] = useDisclosure(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [showConsumed, setShowConsumed] = useState(false);

  const sorted = useMemo(() => {
    const filtered = showConsumed ? [...tokens] : tokens.filter((t) => tokenState(t) === 'active');
    return filtered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [tokens, showConsumed]);

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await revokeEnrollmentToken(id);
      notify.success('Token revoked', 'Enrollment token has been revoked.');
    } catch {
      notify.error('Revoke failed', 'Could not revoke the token.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Stack gap="lg" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Enrollment tokens</Title>
        {canEnroll && (
          <Button leftSection={<IconPlus size={16} />} onClick={openEnroll}>
            Generate token
          </Button>
        )}
      </Group>

      <Text size="sm" c="var(--mantine-color-gray-7)">
        Enrollment tokens authorize a new daemon to join the cluster. Tokens are single-use and
        expire after 7 days. Treat tokens as secrets — they grant join rights until consumed or
        revoked.
      </Text>

      <Group justify="flex-end">
        <Switch
          checked={showConsumed}
          onChange={(e) => {
            setShowConsumed(e.currentTarget.checked);
          }}
          label="Show consumed and expired"
          size="sm"
          aria-label="Show consumed and expired tokens"
          data-testid="show-consumed-toggle"
        />
      </Group>

      {sorted.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="blue" title="No tokens">
          No enrollment tokens have been generated yet.
        </Alert>
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Token (prefix)</Table.Th>
                <Table.Th>State</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Expires</Table.Th>
                <Table.Th>Consumed by</Table.Th>
                {canEnroll && <Table.Th>Actions</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sorted.map((tok) => {
                const state = tokenState(tok);
                return (
                  <Table.Tr key={tok.id} role="row" data-token-id={tok.id} data-state={state}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {tok.token.slice(0, 24)}…
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={stateColor(state)} size="sm" tt="capitalize">
                        {state}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{dayjs(tok.created_at).fromNow()}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{new Date(tok.expires_at).toLocaleDateString()}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace" c="var(--mantine-color-gray-7)">
                        {tok.consumed_by_node_id ?? '—'}
                      </Text>
                    </Table.Td>
                    {canEnroll && (
                      <Table.Td>
                        {state === 'active' && (
                          <Tooltip label="Revoke token">
                            <ActionIcon
                              variant="subtle"
                              color="red.8"
                              size="sm"
                              loading={revokingId === tok.id}
                              onClick={() => {
                                void handleRevoke(tok.id);
                              }}
                              aria-label="Revoke enrollment token"
                            >
                              {revokingId === tok.id ? (
                                <Loader size={12} />
                              ) : (
                                <IconRefresh size={14} />
                              )}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Table.Td>
                    )}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <EnrollModal opened={enrollOpened} onClose={closeEnroll} />
    </Stack>
  );
}
