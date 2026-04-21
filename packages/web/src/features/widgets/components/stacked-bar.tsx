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

const STACKED_COLORS = ['blue.5', 'teal.5', 'violet.4', 'orange.4', 'cyan.5', 'grape.5'];

function tooltipFormatter(value: number): string {
  return value.toLocaleString();
}

export function StackedBarWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={220} width="100%" radius="sm" />;
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
    color: s.color ?? STACKED_COLORS[i % STACKED_COLORS.length] ?? 'blue.5',
  }));

  return (
    <Box role="img" aria-label={`Stacked bar chart for ${widget.title}`} w="100%">
      <BarChart
        h={220}
        w="100%"
        data={data.categories}
        dataKey="label"
        type="stacked"
        series={series}
        withTooltip
        withLegend={series.length > 1}
        legendProps={{ verticalAlign: 'top', height: 28 }}
        gridAxis="y"
        tickLine="y"
        yAxisProps={{ tickFormatter: tooltipFormatter }}
        barProps={{ radius: [3, 3, 0, 0] }}
      />
    </Box>
  );
}
