/**
 * <PieWidget> — pie chart over categorical aggregation.
 *
 * Expected data shape: { slices: { name: string; value: number; color?: string }[] }.
 */
import { Alert, Box, Group, Skeleton, Stack, Text } from '@mantine/core';
import { PieChart } from '@mantine/charts';
import type { WidgetRenderProps } from '../types';

interface PieData {
  slices: { name: string; value: number; color?: string }[];
}

function isPieData(data: unknown): data is PieData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { slices?: unknown }).slices)
  );
}

const FALLBACK_COLORS = ['blue.5', 'teal.5', 'violet.5', 'orange.5', 'cyan.5', 'grape.5', 'red.5', 'green.5'];

export function PieWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={200} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isPieData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ slices: [] }'}
      </Alert>
    );

  const total = data.slices.reduce((sum, s) => sum + s.value, 0);
  const slices = data.slices.map((s, i) => ({
    name: s.name,
    value: s.value,
    color: s.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] ?? 'blue.5',
  }));

  return (
    <Box
      role="img"
      aria-label={`Pie chart for ${widget.title}`}
      style={{ width: '100%' }}
    >
      <Group gap="lg" align="center" justify="center" wrap="wrap">
        <PieChart
          size={180}
          data={slices}
          withTooltip
          tooltipDataSource="segment"
          withLabels
          withLabelsLine
          labelsType="percent"
          labelsPosition="outside"
          strokeWidth={1}
          tooltipProps={{
            formatter: (value) => [
              `${String(value)} (${total > 0 ? ((Number(value) / total) * 100).toFixed(1) : '0'}%)`,
              '',
            ],
          }}
        />
        {/* Legend */}
        <Stack gap={4} style={{ minWidth: 100 }}>
          {slices.map((s) => (
            <Group key={s.name} gap={6} wrap="nowrap">
              <Box
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: `var(--mantine-color-${s.color.replace('.', '-')})`,
                  flexShrink: 0,
                }}
              />
              <Text size="xs" lineClamp={1} style={{ flex: 1 }}>
                {s.name}
              </Text>
              <Text size="xs" fw={600} c="dimmed">
                {total > 0 ? `${((s.value / total) * 100).toFixed(0)}%` : '—'}
              </Text>
            </Group>
          ))}
        </Stack>
      </Group>
    </Box>
  );
}
