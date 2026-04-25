/**
 * <DonutWidget> — donut chart with a centered headline value.
 *
 * Like <PieWidget> but the center hole is bigger and renders the total (or
 * a configured `centerLabel`) inside it.
 *
 * Expected data shape:
 *   { slices: { name: string; value: number; color?: string }[];
 *     centerValue?: string | number;
 *     centerLabel?: string }.
 */
import { Alert, Box, Group, Skeleton, Stack, Text } from '@mantine/core';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { WidgetRenderProps } from '../types';

interface DonutData {
  slices: { name: string; value: number; color?: string }[];
  centerValue?: string | number;
  centerLabel?: string;
}

function isDonutData(data: unknown): data is DonutData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { slices?: unknown }).slices)
  );
}

const FALLBACK_ACCENTS = [
  'riokuSuccess',
  'riokuInfo',
  'riokuWarning',
  'riokuDanger',
  'riokuOrange',
];

function accentVar(name: string): string {
  return `var(--mantine-color-${name}-6)`;
}

export function DonutWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={180} width="100%" radius="md" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isDonutData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ slices: [] }'}
      </Alert>
    );

  const total = data.slices.reduce((sum, s) => sum + s.value, 0);
  const resolved = data.slices.map((s, i) => {
    const color = s.color ?? FALLBACK_ACCENTS[i % FALLBACK_ACCENTS.length] ?? 'riokuOrange';
    return { name: s.name, value: s.value, color: accentVar(color) };
  });

  const centerValue = data.centerValue ?? total.toLocaleString();
  const centerLabel = data.centerLabel ?? 'Total';

  return (
    <Stack
      gap={6}
      h="100%"
      aria-label={`Donut chart for ${widget.title}`}
      style={{ minHeight: 200 }}
    >
      <Box style={{ flex: 1, minHeight: 140, position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={resolved}
              dataKey="value"
              nameKey="name"
              innerRadius="68%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {resolved.map((s) => (
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--mantine-color-default)',
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <Stack
          gap={0}
          align="center"
          justify="center"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}
        >
          <Text fw={700} size="xl">
            {String(centerValue)}
          </Text>
          <Text size="xs" c="dimmed">
            {centerLabel}
          </Text>
        </Stack>
      </Box>
      <Group gap={10} wrap="wrap" justify="center">
        {resolved.map((s) => (
          <Group key={s.name} gap={4} wrap="nowrap">
            <Box
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }}
            />
            <Text size="xs" style={{ whiteSpace: 'nowrap' }}>
              {s.name}
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  );
}
