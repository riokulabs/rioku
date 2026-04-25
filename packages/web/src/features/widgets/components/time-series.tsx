/**
 * <TimeSeriesWidget> — line chart over time with the shared visual language.
 *
 * Expected data shape: { points: { x: string; y: number }[]; series?: string }.
 */
import { Alert, Box } from '@mantine/core';
import {
  CartesianGrid,
  Line,
  LineChart,
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

interface TimeSeriesData {
  points: { x: string; y: number }[];
  series?: string;
}

function isTimeSeriesData(data: unknown): data is TimeSeriesData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { points?: unknown }).points)
  );
}

export function TimeSeriesWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <ChartSkeleton kind="line" height={200} />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isTimeSeriesData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ points: [] }'}
      </Alert>
    );
  if (data.points.length === 0) {
    return (
      <Box p="md" ta="center">
        No data in this range.
      </Box>
    );
  }

  const label = data.series ?? 'value';
  const chartData = data.points.map((p) => ({ x: p.x, [label]: p.y }));
  const stroke = 'var(--mantine-color-riokuInfo-6)';

  return (
    <WidgetContainer>
      <Box
        role="img"
        aria-label={`Time-series for ${widget.title}`}
        style={{ width: '100%', height: '100%', minHeight: 140 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...chartGridProps()} />
            <XAxis dataKey="x" {...chartAxisProps()} minTickGap={20} />
            <YAxis {...chartAxisProps({ width: 32 })} />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{
                stroke: 'var(--mantine-color-default-border)',
                strokeWidth: 1,
                strokeDasharray: '2 4',
              }}
            />
            <Line
              type="monotone"
              dataKey={label}
              stroke={stroke}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--mantine-color-body)' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </WidgetContainer>
  );
}
