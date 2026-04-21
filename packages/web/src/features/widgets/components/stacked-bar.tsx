/**
 * <StackedBarWidget> — stacked bar chart across categories and series.
 *
 * Expected data shape: { categories: { label: string; [seriesName]: number }[];
 *                         series: { name: string; color?: string }[] }.
 */
import { Alert, Box, Skeleton } from '@mantine/core';
import { BarChart } from '@mantine/charts';
import type { WidgetRenderProps } from '../types';

interface StackedBarData {
  categories: Record<string, string | number>[];
  series: { name: string; color?: string }[];
}

function isStackedBarData(data: unknown): data is StackedBarData {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { categories?: unknown; series?: unknown };
  return Array.isArray(d.categories) && Array.isArray(d.series);
}

export function StackedBarWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={200} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isStackedBarData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ categories, series }'}
      </Alert>
    );

  const series = data.series.map((s, i) => ({
    name: s.name,
    color: s.color ?? `blue.${String(3 + ((i * 2) % 6))}`,
  }));

  return (
    <Box
      role="img"
      aria-label={`Stacked bar chart for ${widget.title}`}
      style={{ width: '100%', height: 200 }}
    >
      <BarChart
        h="100%"
        w="100%"
        data={data.categories}
        dataKey="label"
        type="stacked"
        series={series}
        withTooltip
      />
    </Box>
  );
}
