/**
 * <StackedBarWidget> — stacked bar chart across categories and series.
 *
 * Recharts direct (not Mantine's BarChart wrapper) so we can inject the
 * shared dark tooltip + axis/grid styling.
 *
 * Expected data shape: { categories: { label: string; [seriesName]: number }[];
 *                         series: { name: string; color?: string }[] }.
 */
import { Alert, Box } from '@mantine/core';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

interface StackedBarData {
  categories: Record<string, string | number>[];
  series: { name: string; color?: string }[];
}

function isStackedBarData(data: unknown): data is StackedBarData {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { categories?: unknown; series?: unknown };
  return Array.isArray(d.categories) && Array.isArray(d.series);
}

const FALLBACK_COLORS = [
  'riokuSuccess',
  'riokuWarning',
  'riokuDanger',
  'riokuInfo',
  'riokuOrange',
  'grape',
] as const;

export function StackedBarWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <ChartSkeleton kind="bar" height={200} />;
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
  if (data.categories.length === 0) {
    return (
      <Box p="md" ta="center">
        No data in this range.
      </Box>
    );
  }

  const series = data.series.map((s, i) => ({
    name: s.name,
    color: `var(--mantine-color-${s.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] ?? 'riokuInfo'}-6)`,
  }));

  const showLegend = series.length > 1;

  return (
    <WidgetContainer>
      <Box
        role="img"
        aria-label={`Stacked bar chart for ${widget.title}`}
        style={{ width: '100%', height: '100%', minHeight: 140 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.categories} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...chartGridProps()} />
            <XAxis dataKey="label" {...chartAxisProps()} minTickGap={20} />
            <YAxis {...chartAxisProps({ width: 32 })} />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: 'var(--mantine-color-default-hover)', opacity: 0.4 }}
            />
            {showLegend && (
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
              />
            )}
            {series.map((s, idx) => (
              <Bar
                key={s.name}
                dataKey={s.name}
                stackId="stack"
                fill={s.color}
                radius={idx === series.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </WidgetContainer>
  );
}
