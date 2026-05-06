/**
 * <NodeDetailPage> — full-page detail for a single cluster node.
 *
 * Mirrors the drawer's content but in a full layout with breadcrumb-style
 * back navigation and a Remove action. The mutation is gated by
 * cluster:write (UI) and cluster:manage (daemon — see cluster_routes.go).
 */
import { Stack, Title, Group, Button, Text, Anchor, Card, Alert, Modal } from '@mantine/core';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { IconArrowLeft, IconAlertCircle, IconTrash } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useDisclosure } from '@mantine/hooks';
import { useClusterNode, removeNode } from '../api';
import { NodeDetailDrawer } from './node-detail-drawer';

export function NodeDetailPage() {
  const { tenant, nodeId } = useParams({ from: '/t/$tenant/cluster/nodes/$nodeId' });
  const navigate = useNavigate();
  const node = useClusterNode(nodeId);
  const canWrite = usePermission('cluster:write');
  const [removeOpened, { open: openRemove, close: closeRemove }] = useDisclosure(false);

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
          <Title order={2} ff="monospace">
            {node.name}
          </Title>
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

      <Card withBorder padding="lg" radius="md">
        <NodeDetailDrawer nodeId={node.id} />
      </Card>

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
