/**
 * <ClusterPage> — cluster management UI.
 *
 * Sections:
 *   1. Summary cards: total nodes, healthy %, avg version, avg p95 latency
 *   2. Node list table with status/role badges, metrics, actions
 *   3. Enroll new node button + modal
 *   4. Active enrollment tokens list with revoke
 */
import { useState, useMemo } from 'react';
import {
  Stack,
  Title,
  Group,
  Button,
  SimpleGrid,
  Card,
  Text,
  Table,
  Badge,
  ActionIcon,
  Drawer,
  Tooltip,
  Alert,
  Modal,
  Loader,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconTrash, IconEye, IconAlertCircle, IconRefresh } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { StatusBadge } from '@/components/status-badge';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import {
  useClusterNodes,
  useActiveEnrollmentTokens,
  removeNode,
  revokeEnrollmentToken,
} from '../api';
import { deriveRegion } from '../types';
import { EnrollModal } from './enroll-modal';
import { NodeDetailDrawer } from './node-detail-drawer';
import type { StatusKind } from '@/components/status-badge';
import type { ClusterNode } from '../types';

dayjs.extend(relativeTime);

function nodeStatusKind(status: ClusterNode['status']): StatusKind {
  switch (status) {
    case 'healthy':
      return 'success';
    case 'degraded':
      return 'warn';
    case 'unreachable':
      return 'error';
    case 'joining':
      return 'info';
    case 'leaving':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function roleColor(role: ClusterNode['role']): string {
  switch (role) {
    case 'primary':
      return 'blue';
    case 'replica':
      return 'teal';
    case 'witness':
      return 'violet';
    default:
      return 'gray';
  }
}

export function ClusterPage() {
  const nodes = useClusterNodes();
  const activeTokens = useActiveEnrollmentTokens();
  const canWrite = usePermission('cluster:write');
  const canEnroll = usePermission('cluster:enroll');

  const [enrollOpened, { open: openEnroll, close: closeEnroll }] = useDisclosure(false);
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [removingNodeId, setRemovingNodeId] = useState<string | null>(null);
  const [removeModalOpened, { open: openRemoveModal, close: closeRemoveModal }] =
    useDisclosure(false);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);

  // ── Summary stats ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = nodes.length;
    const healthyCount = nodes.filter((n) => n.status === 'healthy').length;
    const healthyPct = total > 0 ? Math.round((healthyCount / total) * 100) : 0;
    const avgLatency =
      total > 0
        ? Math.round(nodes.reduce((sum, n) => sum + n.metrics.latency_p95_ms, 0) / total)
        : 0;
    const primaryVersion = nodes.find((n) => n.role === 'primary')?.version ?? '—';
    return { total, healthyCount, healthyPct, avgLatency, primaryVersion };
  }, [nodes]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleViewNode(node: ClusterNode) {
    setSelectedNodeId(node.id);
    openDrawer();
  }

  function handleRemoveClick(node: ClusterNode) {
    setRemovingNodeId(node.id);
    openRemoveModal();
  }

  async function handleConfirmRemove() {
    if (!removingNodeId) return;
    try {
      await removeNode(removingNodeId);
      notify.success('Node removed', 'The cluster node has been removed.');
    } catch {
      notify.error('Remove failed', 'Could not remove the node.');
    } finally {
      setRemovingNodeId(null);
      closeRemoveModal();
    }
  }

  async function handleRevokeToken(tokenId: string) {
    setRevokingTokenId(tokenId);
    try {
      await revokeEnrollmentToken(tokenId);
      notify.success('Token revoked', 'Enrollment token has been revoked.');
    } catch {
      notify.error('Revoke failed', 'Could not revoke the token.');
    } finally {
      setRevokingTokenId(null);
    }
  }

  const removingNode = removingNodeId ? nodes.find((n) => n.id === removingNodeId) : null;

  return (
    <Stack gap="lg" p="md">
      {/* Header */}
      <Group justify="space-between" align="center">
        <Title order={2}>Cluster</Title>
        {canEnroll && (
          <Button leftSection={<IconPlus size={16} />} onClick={openEnroll}>
            Enroll node
          </Button>
        )}
      </Group>

      {/* Summary cards */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <Card withBorder padding="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Total nodes
          </Text>
          <Text size="xl" fw={700} mt={4}>
            {stats.total}
          </Text>
        </Card>
        <Card withBorder padding="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Healthy
          </Text>
          <Text
            size="xl"
            fw={700}
            mt={4}
            c={stats.healthyPct === 100 ? 'teal' : stats.healthyPct >= 75 ? 'yellow' : 'red'}
          >
            {stats.healthyPct}%
          </Text>
          <Text size="xs" c="dimmed">
            {stats.healthyCount} of {stats.total}
          </Text>
        </Card>
        <Card withBorder padding="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Cluster version
          </Text>
          <Text size="xl" fw={700} mt={4} ff="monospace">
            {stats.primaryVersion}
          </Text>
        </Card>
        <Card withBorder padding="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Avg p95 latency
          </Text>
          <Text size="xl" fw={700} mt={4}>
            {stats.avgLatency}
            <Text component="span" size="sm" fw={400} c="dimmed">
              {' '}
              ms
            </Text>
          </Text>
        </Card>
      </SimpleGrid>

      {/* Node list */}
      <Stack gap="sm">
        <Title order={4}>Nodes</Title>
        {nodes.length === 0 ? (
          <Alert icon={<IconAlertCircle size={16} />} color="blue" title="No nodes">
            No cluster nodes found. Enroll the first node to get started.
          </Alert>
        ) : (
          <Table.ScrollContainer minWidth={800}>
            <Table withTableBorder withColumnBorders highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Region</Table.Th>
                  <Table.Th>Version</Table.Th>
                  <Table.Th>RPS</Table.Th>
                  <Table.Th>p95 (ms)</Table.Th>
                  <Table.Th>Last heartbeat</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {nodes.map((node) => (
                  <Table.Tr
                    key={node.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      handleViewNode(node);
                    }}
                  >
                    <Table.Td>
                      <Text size="sm" fw={500} ff="monospace">
                        {node.name}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {node.address}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={roleColor(node.role)} size="sm" tt="capitalize">
                        {node.role}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge kind={nodeStatusKind(node.status)} size="sm" tt="capitalize">
                        {node.status}
                      </StatusBadge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {deriveRegion(node)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {node.version}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {node.metrics.requests_per_second.toLocaleString()}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text
                        size="sm"
                        ff="monospace"
                        {...(node.metrics.latency_p95_ms > 100
                          ? { c: 'red' }
                          : node.metrics.latency_p95_ms > 50
                            ? { c: 'yellow' }
                            : {})}
                      >
                        {node.metrics.latency_p95_ms}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{dayjs(node.last_heartbeat_at).fromNow()}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group
                        gap={4}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <Tooltip label="View details">
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            onClick={() => {
                              handleViewNode(node);
                            }}
                            aria-label="View node details"
                          >
                            <IconEye size={14} />
                          </ActionIcon>
                        </Tooltip>
                        {canWrite && node.role !== 'primary' && (
                          <Tooltip label="Remove node">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              onClick={() => {
                                handleRemoveClick(node);
                              }}
                              aria-label="Remove node"
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>

      {/* Active enrollment tokens */}
      <Stack gap="sm">
        <Title order={4}>Active enrollment tokens</Title>
        {activeTokens.length === 0 ? (
          <Text size="sm" c="dimmed">
            No active enrollment tokens.
          </Text>
        ) : (
          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Token (prefix)</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Expires</Table.Th>
                {canWrite && <Table.Th>Actions</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {activeTokens.map((tok) => (
                <Table.Tr key={tok.id}>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {tok.token.slice(0, 24)}…
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{dayjs(tok.created_at).fromNow()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{new Date(tok.expires_at).toLocaleDateString()}</Text>
                  </Table.Td>
                  {canWrite && (
                    <Table.Td>
                      <Tooltip label="Revoke token">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          loading={revokingTokenId === tok.id}
                          onClick={() => {
                            void handleRevokeToken(tok.id);
                          }}
                          aria-label="Revoke enrollment token"
                        >
                          {revokingTokenId === tok.id ? (
                            <Loader size={12} />
                          ) : (
                            <IconRefresh size={14} />
                          )}
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      {/* Enroll modal */}
      <EnrollModal opened={enrollOpened} onClose={closeEnroll} />

      {/* Node detail drawer */}
      <Drawer
        opened={drawerOpened}
        onClose={() => {
          closeDrawer();
          setSelectedNodeId(null);
        }}
        title="Node details"
        position="right"
        size="min(480px, 95vw)"
        padding="md"
      >
        {selectedNodeId && <NodeDetailDrawer nodeId={selectedNodeId} />}
      </Drawer>

      {/* Remove confirm modal */}
      <Modal
        opened={removeModalOpened}
        onClose={closeRemoveModal}
        title="Remove cluster node"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Remove node{' '}
            <Text component="span" fw={600} ff="monospace">
              {removingNode?.name ?? ''}
            </Text>
            ? This will evict the node from the cluster. It can re-join with a new enrollment token.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeRemoveModal}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                void handleConfirmRemove();
              }}
            >
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
