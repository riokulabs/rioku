/**
 * <TimeSeriesWidget> — line chart over time.
 *
 * Expected data shape: { points: { x: string; y: number }[]; series?: string }.
 */
import { Alert, Box, Skeleton } from '@mantine/core';
import { LineChart } from '@mantine/charts';
import type { WidgetRenderProps } from '../types';

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
  if (loading) return <Skeleton height={200} width="100%" radius="sm" />;
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

  const label = data.series ?? 'value';
  const chartData = data.points.map((p) => ({ x: p.x, [label]: p.y }));

  return (
    <Box
      role="img"
      aria-label={`Time-series for ${widget.title}`}
      style={{ width: '100%', height: 200 }}
    >
      <LineChart
        h="100%"
        w="100%"
        data={chartData}
        dataKey="x"
        series={[{ name: label, color: 'blue.6' }]}
        curveType="monotone"
        withDots={false}
        withTooltip
      />
    </Box>
  );
}
