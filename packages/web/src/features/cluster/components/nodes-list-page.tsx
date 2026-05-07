/**
 * <NodesListPage> — focused cluster nodes list at /t/$tenant/cluster/nodes.
 *
 * Shows summary stat cards (total nodes, healthy count, unhealthy count) and
 * the node table. Selecting a row navigates to the full-page detail
 * (`cluster/nodes/$nodeId`). The "Remove node" action lives in the row
 * actions and the detail drawer; revoke/enroll are on the dedicated tokens
 * page.
 *
 * Mutations gated by usePermission('cluster:write').
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
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link, useParams } from '@tanstack/react-router';
import { IconPlus, IconTrash, IconEye, IconAlertCircle } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { StatusBadge } from '@/components/status-badge';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useClusterNodes, removeNode } from '../api';
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

function isUnhealthy(status: ClusterNode['status']): boolean {
  return status === 'degraded' || status === 'unreachable';
}

export function NodesListPage() {
  const nodes = useClusterNodes();
  const { tenant } = useParams({ from: '/t/$tenant/cluster/nodes' });
  const canWrite = usePermission('cluster:write');
  const canEnroll = usePermission('cluster:enroll');

  const [enrollOpened, { open: openEnroll, close: closeEnroll }] = useDisclosure(false);
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
  const [removingNodeId, setRemovingNodeId] = useState<string | null>(null);
  const [removeModalOpened, { open: openRemoveModal, close: closeRemoveModal }] =
    useDisclosure(false);

  const stats = useMemo(() => {
    const total = nodes.length;
    const healthy = nodes.filter((n) => n.status === 'healthy').length;
    const unhealthy = nodes.filter((n) => isUnhealthy(n.status)).length;

    // Version distribution — count nodes per daemon version, return the
    // top 3 most common entries as `${version}: ${count}`.
    const versionCounts = new Map<string, number>();
    for (const n of nodes) {
      versionCounts.set(n.version, (versionCounts.get(n.version) ?? 0) + 1);
    }
    const versionDistribution = Array.from(versionCounts.entries())
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 3);

    // Cluster-wide p95 latency: max of per-node p95 (worst-case proxy
    // until the PromQL `histogram_quantile` over all nodes lands).
    const p95 =
      nodes.length === 0 ? 0 : Math.max(...nodes.map((n) => n.metrics.latency_p95_ms));

    return { total, healthy, unhealthy, versionDistribution, p95 };
  }, [nodes]);

  function handlePreview(node: ClusterNode) {
    setPreviewNodeId(node.id);
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

  const removingNode = removingNodeId ? nodes.find((n) => n.id === removingNodeId) : null;

  return (
    <Stack gap="lg" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Cluster nodes</Title>
        {canEnroll && (
          <Button leftSection={<IconPlus size={16} />} onClick={openEnroll}>
            Enroll node
          </Button>
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md" data-testid="cluster-stat-cards">
        <Card withBorder padding="md" radius="md" data-testid="stat-total-nodes">
          <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
            Total nodes
          </Text>
          <Text size="xl" fw={700} mt={4}>
            {stats.total}
          </Text>
        </Card>
        <Card withBorder padding="md" radius="md" data-testid="stat-healthy">
          <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
            Healthy
          </Text>
          <Text size="xl" fw={700} mt={4} c="teal.4">
            {stats.healthy}
          </Text>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            {stats.unhealthy === 0
              ? 'all nodes reporting'
              : `${String(stats.unhealthy)} degraded or unreachable`}
          </Text>
        </Card>
        <Card withBorder padding="md" radius="md" data-testid="stat-version-distribution">
          <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
            Versions
          </Text>
          {stats.versionDistribution.length === 0 ? (
            <Text size="sm" mt={4} c="var(--mantine-color-gray-7)">
              —
            </Text>
          ) : (
            <Stack gap={2} mt={4}>
              {stats.versionDistribution.map(([version, count]) => (
                <Group key={version} justify="space-between" gap="xs">
                  <Text size="sm" ff="monospace" fw={600}>
                    {version}
                  </Text>
                  <Text size="xs" c="var(--mantine-color-gray-7)">
                    {count} {count === 1 ? 'node' : 'nodes'}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </Card>
        <Card withBorder padding="md" radius="md" data-testid="stat-p95-latency">
          <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
            p95 latency
          </Text>
          <Text
            size="xl"
            fw={700}
            mt={4}
            c={stats.p95 > 100 ? 'red.4' : stats.p95 > 50 ? 'yellow.4' : 'teal.4'}
          >
            {stats.p95}
            <Text component="span" size="sm" fw={400} c="var(--mantine-color-gray-7)">
              {' '}
              ms
            </Text>
          </Text>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            worst node, cluster-wide
          </Text>
        </Card>
      </SimpleGrid>

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
                <Table.Tr key={node.id} role="row" data-node-id={node.id}>
                  <Table.Td>
                    <Text size="sm" fw={500} ff="monospace">
                      {node.name}
                    </Text>
                    <Text size="xs" c="var(--mantine-color-gray-7)" ff="monospace">
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
                        ? { c: 'red.4' }
                        : node.metrics.latency_p95_ms > 50
                          ? { c: 'yellow.4' }
                          : {})}
                    >
                      {node.metrics.latency_p95_ms}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{dayjs(node.last_heartbeat_at).fromNow()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <Tooltip label="Quick preview">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          onClick={() => {
                            handlePreview(node);
                          }}
                          aria-label="Preview node details"
                        >
                          <IconEye size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Button
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
                        component={Link as any}
                        to="/t/$tenant/cluster/nodes/$nodeId"
                        params={{ tenant, nodeId: node.id }}
                        variant="subtle"
                        size="compact-xs"
                      >
                        Open
                      </Button>
                      {canWrite && node.role !== 'primary' && (
                        <Tooltip label="Remove node">
                          <ActionIcon
                            variant="subtle"
                            color="red.8"
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

      <EnrollModal opened={enrollOpened} onClose={closeEnroll} />

      <Drawer
        opened={drawerOpened}
        onClose={() => {
          closeDrawer();
          setPreviewNodeId(null);
        }}
        title="Node details"
        position="right"
        size="min(480px, 95vw)"
        padding="md"
      >
        {previewNodeId && <NodeDetailDrawer nodeId={previewNodeId} />}
      </Drawer>

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
              color="red.8"
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
