/**
 * <SparklineWidget> — tiny trend-line for time-series.
 *
 * Expected data shape: { points: { x: string|number; y: number }[] }.
 */
import { Alert, Box, Skeleton } from '@mantine/core';
import { AreaChart } from '@mantine/charts';
import type { WidgetRenderProps } from '../types';

interface SparklineData {
  points: { x: string | number; y: number }[];
  color?: string;
}

function isSparklineData(data: unknown): data is SparklineData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { points?: unknown }).points)
  );
}

export function SparklineWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={72} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isSparklineData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ points: [] }'}
      </Alert>
    );

  const color = data.color ?? 'blue.5';
  const chartData = data.points.map((p) => ({ x: String(p.x), value: p.y }));

  return (
    <Box role="img" aria-label={`Sparkline for ${widget.title}`} style={{ height: 72, width: '100%' }}>
      <AreaChart
        h={72}
        w="100%"
        data={chartData}
        dataKey="x"
        series={[{ name: 'value', color }]}
        curveType="monotone"
        withXAxis={false}
        withYAxis={false}
        withDots={false}
        withTooltip={false}
        withGradient
        strokeWidth={2}
        gridAxis="none"
        fillOpacity={0.18}
      />
    </Box>
  );
}
