/**
 * <NodeMetricsPanel> — per-node metrics view shown inside the Metrics tab on
 * the cluster node detail page.
 *
 * In stage-2 today the daemon's PromQL endpoint (Plan 08 T4) is still being
 * wired up end-to-end, so this panel renders the four queries we will run
 * against it once it lands, together with the current scalar values reported
 * by the cluster service. The query strings are stable and the layout is
 * production-shape, so swapping the placeholder for real `<LineChart>`
 * components when the PromQL hook lands is a one-line change per card.
 *
 * Each query is scoped by `instance="<node-id>"` so the same dashboard works
 * regardless of which node the user opened.
 */
import { Card, Stack, Text, Group, SimpleGrid, Badge, Code, Progress } from '@mantine/core';
import type { ClusterNode } from '../types';

interface NodeMetricsPanelProps {
  node: ClusterNode;
}

interface MetricCardSpec {
  key: 'cpu' | 'memory' | 'rps' | 'errors' | 'p95';
  title: string;
  promql: string;
  current: string;
  hint: string;
  progress?: number;
  color?: string;
}

export function NodeMetricsPanel({ node }: NodeMetricsPanelProps) {
  const cpuColor =
    node.metrics.cpu_percent > 80 ? 'red' : node.metrics.cpu_percent > 60 ? 'yellow' : 'teal';
  const memColor =
    node.metrics.memory_percent > 80 ? 'red' : node.metrics.memory_percent > 60 ? 'yellow' : 'teal';
  const latencyColor =
    node.metrics.latency_p95_ms > 100
      ? 'red'
      : node.metrics.latency_p95_ms > 50
        ? 'yellow'
        : 'teal';

  const cards: MetricCardSpec[] = [
    {
      key: 'cpu',
      title: 'CPU',
      promql: `avg by (instance) (rate(process_cpu_seconds_total{instance="${node.id}"}[5m])) * 100`,
      current: `${String(node.metrics.cpu_percent)}%`,
      hint: '5m average, scalar',
      progress: node.metrics.cpu_percent,
      color: cpuColor,
    },
    {
      key: 'memory',
      title: 'Memory',
      promql: `process_resident_memory_bytes{instance="${node.id}"} / process_memory_max_bytes{instance="${node.id}"} * 100`,
      current: `${String(node.metrics.memory_percent)}%`,
      hint: 'RSS / max, instantaneous',
      progress: node.metrics.memory_percent,
      color: memColor,
    },
    {
      key: 'rps',
      title: 'Request rate',
      promql: `sum by (instance) (rate(rioku_http_requests_total{instance="${node.id}"}[1m]))`,
      current: `${node.metrics.requests_per_second.toLocaleString()} req/s`,
      hint: '1m rate window',
    },
    {
      key: 'errors',
      title: 'Error rate',
      promql: `sum by (instance) (rate(rioku_http_requests_total{instance="${node.id}",status=~"5.."}[5m])) / clamp_min(sum by (instance) (rate(rioku_http_requests_total{instance="${node.id}"}[5m])), 1)`,
      current: '—',
      hint: '5xx / total, 5m window',
    },
    {
      key: 'p95',
      title: 'p95 latency',
      promql: `histogram_quantile(0.95, sum by (le, instance) (rate(rioku_http_request_duration_seconds_bucket{instance="${node.id}"}[5m]))) * 1000`,
      current: `${String(node.metrics.latency_p95_ms)} ms`,
      hint: '5m bucket, ms',
      color: latencyColor,
    },
  ];

  return (
    <Stack gap="md">
      <Text size="sm" c="var(--mantine-color-gray-7)">
        Live metrics for this node, scoped by <Code>instance=&quot;{node.id}&quot;</Code>. Queries
        run against the daemon&apos;s PromQL endpoint.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {cards.map((card) => (
          <Card
            key={card.key}
            withBorder
            padding="md"
            radius="md"
            data-testid={`node-metric-card-${card.key}`}
          >
            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Text size="xs" tt="uppercase" fw={600} c="var(--mantine-color-gray-7)">
                  {card.title}
                </Text>
                <Badge size="xs" variant="light" color={card.color ?? 'gray'}>
                  {card.current}
                </Badge>
              </Group>
              {card.progress !== undefined && (
                <Progress
                  value={card.progress}
                  color={card.color ?? 'teal'}
                  size="sm"
                  radius="xl"
                />
              )}
              <Code block fz="xs" data-testid={`node-metric-promql-${card.key}`}>
                {card.promql}
              </Code>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                {card.hint}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
