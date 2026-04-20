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
}

function isSparklineData(data: unknown): data is SparklineData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { points?: unknown }).points)
  );
}

export function SparklineWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={60} width="100%" radius="sm" />;
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

  const chartData = data.points.map((p) => ({ x: String(p.x), y: p.y }));

  return (
    <Box role="img" aria-label={`Sparkline for ${widget.title}`} style={{ height: 60 }}>
      <AreaChart
        h={60}
        data={chartData}
        dataKey="x"
        series={[{ name: 'y', color: 'blue.6' }]}
        curveType="monotone"
        withXAxis={false}
        withYAxis={false}
        withDots={false}
        withTooltip={false}
        withGradient
        strokeWidth={1.5}
        gridAxis="none"
      />
    </Box>
  );
}
