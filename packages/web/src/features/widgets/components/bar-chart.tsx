/**
 * <BarChartWidget> — single-series vertical bar chart.
 *
 * Uses the shared chart visual language (dark tooltip, soft grid, no axis
 * lines, monospace tabular ticks). Differs from <StackedBarWidget> which is
 * multi-series stacked.
 *
 * Expected data shape: { bars: { name: string; value: number; color?: string }[] }.
 */
import { Alert, Box } from '@mantine/core';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WidgetRenderProps } from '../types';
import {
  ChartTooltip,
  chartAxisProps,
  chartGridProps,
  ChartSkeleton,
  WidgetContainer,
} from '../chart-primitives';

interface BarData {
  bars: { name: string; value: number; color?: string }[];
}

function isBarData(data: unknown): data is BarData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { bars?: unknown }).bars)
  );
}

const FALLBACK_ACCENT = 'var(--mantine-color-riokuInfo-6)';

export function BarChartWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <ChartSkeleton kind="bar" height={180} />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isBarData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ bars: [] }'}
      </Alert>
    );
  if (data.bars.length === 0) {
    return (
      <Box p="md" ta="center">
        No data in this range.
      </Box>
    );
  }

  return (
    <WidgetContainer>
      <Box
        role="img"
        aria-label={`Bar chart for ${widget.title}`}
        style={{ width: '100%', height: '100%', minHeight: 140 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.bars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...chartGridProps()} />
            <XAxis dataKey="name" {...chartAxisProps()} minTickGap={12} />
            <YAxis {...chartAxisProps({ width: 32 })} />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: 'var(--mantine-color-default-hover)', opacity: 0.4 }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.bars.map((b) => (
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                <Cell key={b.name} fill={b.color ?? FALLBACK_ACCENT} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </WidgetContainer>
  );
}
