/**
 * <NodeDetailDrawer> — full metrics + metadata for a single cluster node.
 */
import { Stack, Title, Text, Group, Badge, Table, Progress, Divider } from '@mantine/core';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { StatusBadge } from '@/components/status-badge';
import { useClusterNode } from '../api';
import { deriveRegion } from '../types';
import type { StatusKind } from '@/components/status-badge';

dayjs.extend(relativeTime);

function nodeStatusKind(status: string): StatusKind {
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

function roleColor(role: string): string {
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

interface NodeDetailDrawerProps {
  nodeId: string;
}

export function NodeDetailDrawer({ nodeId }: NodeDetailDrawerProps) {
  const node = useClusterNode(nodeId);

  if (!node) {
    return <Text c="var(--mantine-color-gray-7)">Node not found.</Text>;
  }

  const cpuColor =
    node.metrics.cpu_percent > 80 ? 'red' : node.metrics.cpu_percent > 60 ? 'yellow' : 'teal';
  const memColor =
    node.metrics.memory_percent > 80 ? 'red' : node.metrics.memory_percent > 60 ? 'yellow' : 'teal';

  return (
    <Stack gap="md">
      {/* Header */}
      <Group align="flex-start" justify="space-between">
        <Stack gap={4}>
          <Title order={4} ff="monospace">
            {node.name}
          </Title>
          <Text size="xs" c="var(--mantine-color-gray-7)" ff="monospace">
            {node.address}
          </Text>
        </Stack>
        <Group gap="xs">
          <Badge variant="light" color={roleColor(node.role)} tt="capitalize">
            {node.role}
          </Badge>
          <StatusBadge kind={nodeStatusKind(node.status)} tt="capitalize">
            {node.status}
          </StatusBadge>
        </Group>
      </Group>

      <Divider />

      {/* Identity table */}
      <Stack gap={4}>
        <Text size="xs" fw={600} tt="uppercase" c="var(--mantine-color-gray-7)">
          Identity
        </Text>
        <Table withRowBorders={false} fz="sm">
          <Table.Tbody>
            <Table.Tr>
              <Table.Td c="var(--mantine-color-gray-7)" w={130}>
                Region
              </Table.Td>
              <Table.Td ff="monospace">{deriveRegion(node)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="var(--mantine-color-gray-7)">Version</Table.Td>
              <Table.Td ff="monospace">{node.version}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="var(--mantine-color-gray-7)">Joined</Table.Td>
              <Table.Td>{dayjs(node.joined_at).fromNow()}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="var(--mantine-color-gray-7)">Last heartbeat</Table.Td>
              <Table.Td>{dayjs(node.last_heartbeat_at).fromNow()}</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Stack>

      <Divider />

      {/* Metrics */}
      <Stack gap="sm">
        <Text size="xs" fw={600} tt="uppercase" c="var(--mantine-color-gray-7)">
          Current metrics
        </Text>

        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm">CPU</Text>
            <Text size="sm" fw={500}>
              {node.metrics.cpu_percent}%
            </Text>
          </Group>
          <Progress value={node.metrics.cpu_percent} color={cpuColor} size="sm" radius="xl" />
        </Stack>

        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm">Memory</Text>
            <Text size="sm" fw={500}>
              {node.metrics.memory_percent}%
            </Text>
          </Group>
          <Progress value={node.metrics.memory_percent} color={memColor} size="sm" radius="xl" />
        </Stack>

        <Table withRowBorders={false} fz="sm" mt="xs">
          <Table.Tbody>
            <Table.Tr>
              <Table.Td c="var(--mantine-color-gray-7)">Requests/sec</Table.Td>
              <Table.Td ff="monospace">
                {node.metrics.requests_per_second.toLocaleString()}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="var(--mantine-color-gray-7)">p95 latency</Table.Td>
              <Table.Td ff="monospace">{node.metrics.latency_p95_ms} ms</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Stack>
    </Stack>
  );
}
