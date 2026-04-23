/**
 * <AreaChartWidget> — multi-series area chart with gradient fills + legend.
 *
 * Richer than <SparklineWidget> and <TimeSeriesWidget>: renders multiple
 * stacked/unstacked series with per-series gradient fills, axes with dimmed
 * tick labels, grid lines, tooltip, and an inline legend. Uses recharts
 * directly so we have full control over fill gradients and tick styling.
 *
 * Expected data shape:
 *   { points: Record<string, string | number>[],
 *     series: { name: string; color?: string }[],
 *     stacked?: boolean }
 *
 * `points[i].x` is the X-axis label. Other keys (one per series name) hold
 * the numeric values.
 */
import { Alert, Box, Group, Skeleton, Stack, Text } from '@mantine/core';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WidgetRenderProps } from '../types';

interface AreaChartData {
  points: Record<string, string | number>[];
  series: { name: string; color?: string }[];
  stacked?: boolean;
}

function isAreaChartData(data: unknown): data is AreaChartData {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { points?: unknown; series?: unknown };
  return Array.isArray(d.points) && Array.isArray(d.series);
}

const FALLBACK_ACCENTS = ['riokuOrange', 'riokuInfo', 'riokuSuccess', 'riokuWarning', 'riokuDanger'];

interface TooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (active !== true || !payload || payload.length === 0) return null;
  return (
    <Box
      style={{
        background: 'var(--mantine-color-default)',
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 8,
        padding: '6px 10px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        minWidth: 160,
      }}
    >
      <Text size="xs" fw={600} c="dimmed" mb={4}>
        {label}
      </Text>
      <Stack gap={2}>
        {payload.map((p) => (
          <Group key={p.dataKey ?? p.name} gap={6} wrap="nowrap" justify="space-between">
            <Group gap={6} wrap="nowrap">
              <Box
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: p.color,
                  flexShrink: 0,
                }}
              />
              <Text size="xs">{p.name}</Text>
            </Group>
            <Text size="xs" ff="monospace" fw={600}>
              {(p.value ?? 0).toLocaleString()}
            </Text>
          </Group>
        ))}
      </Stack>
    </Box>
  );
}

export function AreaChartWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={200} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isAreaChartData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ points, series }'}
      </Alert>
    );

  const seriesWithColor = data.series.map((s, i) => ({
    name: s.name,
    color: s.color ?? FALLBACK_ACCENTS[i % FALLBACK_ACCENTS.length] ?? 'riokuOrange',
  }));

  const stackId = data.stacked === true ? '1' : undefined;

  return (
    <Box
      role="img"
      aria-label={`Area chart for ${widget.title}`}
      style={{ width: '100%', height: '100%', minHeight: 160 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {seriesWithColor.map((s) => (
              <linearGradient
                key={`grad-${widget.id}-${s.name}`}
                id={`grad-${widget.id}-${s.name}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={`var(--mantine-color-${s.color}-6)`}
                  stopOpacity={0.45}
                />
                <stop
                  offset="100%"
                  stopColor={`var(--mantine-color-${s.color}-6)`}
                  stopOpacity={0.02}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke="var(--mantine-color-default-border)"
            vertical={false}
          />
          <XAxis
            dataKey="x"
            tick={{ fontSize: 10, fill: 'var(--mantine-color-dimmed)' }}
            tickLine={false}
            axisLine={false}
            minTickGap={20}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--mantine-color-dimmed)' }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{
              stroke: 'var(--mantine-color-default-border)',
              strokeWidth: 1,
              strokeDasharray: '2 4',
            }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
          />
          {seriesWithColor.map((s) => (
            <Area
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={`var(--mantine-color-${s.color}-6)`}
              strokeWidth={2}
              fill={`url(#grad-${widget.id}-${s.name})`}
              {...(stackId !== undefined ? { stackId } : {})}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
