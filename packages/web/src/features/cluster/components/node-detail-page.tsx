/**
 * <NodeDetailPage> — full-page detail for a single cluster node.
 *
 * Three Mantine Tabs:
 *   1. Overview — identity, role, version, last-heartbeat, current snapshot
 *   2. Metrics  — PromQL-backed time series scoped to instance="<node-id>"
 *                 (charts: CPU, memory, request rate, error rate, p95 latency)
 *   3. Audit    — cluster-scoped audit entries filtered by
 *                 resource_type=cluster + resource_id=<node-id>
 *
 * Mutations (Remove node) are gated client-side by `cluster:write`; the
 * daemon enforces `cluster:manage` (see cluster_routes.go).
 */
import { useMemo } from 'react';
import {
  Stack,
  Title,
  Group,
  Button,
  Text,
  Anchor,
  Card,
  Alert,
  Modal,
  Tabs,
  SimpleGrid,
  Badge,
} from '@mantine/core';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  IconArrowLeft,
  IconAlertCircle,
  IconTrash,
  IconInfoCircle,
  IconChartLine,
  IconHistory,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useDisclosure } from '@mantine/hooks';
import { StatusBadge } from '@/components/status-badge';
import { useAuditList } from '@/features/audit/api';
import { useMockStore } from '@/api/mock-store';
import { useClusterNode, removeNode } from '../api';
import { deriveRegion } from '../types';
import { NodeMetricsPanel } from './node-metrics-panel';
import type { StatusKind } from '@/components/status-badge';
import type { ClusterNode } from '../types';
import type { AuditFilter } from '@/features/audit/types';

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

const EMPTY_FILTER: AuditFilter = {
  actions: [],
  outcomes: [],
  resource_types: ['cluster'],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  resource_id_handles: [],
  search: '',
};

export function NodeDetailPage() {
  const { tenant, nodeId } = useParams({ from: '/t/$tenant/cluster/nodes/$nodeId' });
  const navigate = useNavigate();
  const node = useClusterNode(nodeId);
  const canWrite = usePermission('cluster:write');
  const [removeOpened, { open: openRemove, close: closeRemove }] = useDisclosure(false);

  const tenantId = useMockStore((s) => s.currentTenantId);
  const allClusterAudit = useAuditList(tenantId ?? '', EMPTY_FILTER);
  const nodeAudit = useMemo(
    () => allClusterAudit.filter((entry) => entry.resource_id === nodeId),
    [allClusterAudit, nodeId],
  );

  async function handleRemove() {
    if (!node) return;
    try {
      await removeNode(node.id);
      notify.success('Node removed', `${node.name} has been removed from the cluster.`);
      void navigate({
        to: '/t/$tenant/cluster/nodes',
        params: { tenant },
      });
    } catch {
      notify.error('Remove failed', 'Could not remove the node.');
    } finally {
      closeRemove();
    }
  }

  if (!node) {
    return (
      <Stack gap="md" p="md">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
          component={Link as any}
          to="/t/$tenant/cluster/nodes"
          params={{ tenant }}
          size="sm"
        >
          <Group gap={4}>
            <IconArrowLeft size={14} /> Back to nodes
          </Group>
        </Anchor>
        <Alert icon={<IconAlertCircle size={16} />} color="yellow" title="Node not found">
          <Text size="sm">The node id {nodeId} no longer exists. It may have been removed.</Text>
        </Alert>
      </Stack>
    );
  }

  const canRemove = canWrite && node.role !== 'primary';

  return (
    <Stack gap="lg" p="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Anchor
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
            component={Link as any}
            to="/t/$tenant/cluster/nodes"
            params={{ tenant }}
            size="sm"
          >
            <Group gap={4}>
              <IconArrowLeft size={14} /> Back to nodes
            </Group>
          </Anchor>
          <Group gap="xs" align="center">
            <Title order={2} ff="monospace">
              {node.name}
            </Title>
            <Badge variant="light" color={roleColor(node.role)} tt="capitalize">
              {node.role}
            </Badge>
            <StatusBadge kind={nodeStatusKind(node.status)} tt="capitalize">
              {node.status}
            </StatusBadge>
          </Group>
        </Stack>
        {canRemove && (
          <Button
            color="red.8"
            variant="light"
            leftSection={<IconTrash size={16} />}
            onClick={openRemove}
          >
            Remove node
          </Button>
        )}
      </Group>

      <Tabs defaultValue="overview" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconInfoCircle size={14} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="metrics" leftSection={<IconChartLine size={14} />}>
            Metrics
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Card withBorder padding="lg" radius="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Stack gap={4}>
                <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
                  Node ID
                </Text>
                <Text size="sm" ff="monospace">
                  {node.id}
                </Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
                  Address
                </Text>
                <Text size="sm" ff="monospace">
                  {node.address}
                </Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
                  Region
                </Text>
                <Text size="sm" ff="monospace">
                  {deriveRegion(node)}
                </Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
                  Daemon version
                </Text>
                <Text size="sm" ff="monospace">
                  {node.version}
                </Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
                  Joined
                </Text>
                <Text size="sm">{dayjs(node.joined_at).fromNow()}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase" fw={600}>
                  Last heartbeat
                </Text>
                <Text size="sm">{dayjs(node.last_heartbeat_at).fromNow()}</Text>
              </Stack>
            </SimpleGrid>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="metrics" pt="md">
          <NodeMetricsPanel node={node} />
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <Card withBorder padding="lg" radius="md">
            {nodeAudit.length === 0 ? (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="blue"
                title="No audit entries"
                variant="light"
              >
                <Text size="sm">
                  No cluster-related audit entries reference this node yet. Actions like
                  enrollment, role changes, or removal will appear here.
                </Text>
              </Alert>
            ) : (
              <Stack gap="xs" data-testid="cluster-node-audit-list">
                {nodeAudit.map((entry) => (
                  <Group key={entry.id} justify="space-between" wrap="nowrap" gap="md">
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Group gap="xs">
                        <Text size="sm" fw={500} ff="monospace">
                          {entry.action}
                        </Text>
                        <Badge
                          size="xs"
                          variant="light"
                          color={
                            entry.tier === 'destructive'
                              ? 'red'
                              : entry.tier === 'write'
                                ? 'yellow'
                                : 'gray'
                          }
                          tt="lowercase"
                        >
                          {entry.tier}
                        </Badge>
                        <Badge
                          size="xs"
                          variant="light"
                          color={entry.outcome === 'success' ? 'teal' : 'red'}
                          tt="lowercase"
                        >
                          {entry.outcome}
                        </Badge>
                      </Group>
                      <Text size="xs" c="var(--mantine-color-gray-7)">
                        actor {entry.actor_id}
                      </Text>
                    </Stack>
                    <Text size="xs" c="var(--mantine-color-gray-7)" style={{ whiteSpace: 'nowrap' }}>
                      {dayjs(entry.at).fromNow()}
                    </Text>
                  </Group>
                ))}
              </Stack>
            )}
          </Card>
        </Tabs.Panel>
      </Tabs>

      <Modal opened={removeOpened} onClose={closeRemove} title="Remove cluster node" size="sm">
        <Stack gap="md">
          <Text size="sm">
            Remove node{' '}
            <Text component="span" fw={600} ff="monospace">
              {node.name}
            </Text>
            ? This will evict the node from the cluster. It can re-join with a new enrollment token.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeRemove}>
              Cancel
            </Button>
            <Button
              color="red.8"
              onClick={() => {
                void handleRemove();
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

