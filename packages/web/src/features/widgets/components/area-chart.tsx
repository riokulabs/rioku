/**
 * <AreaChartWidget> — multi-series area chart with gradient fills + legend.
 *
 * Premium visual language: dark tooltip card, no vertical gridlines, soft
 * horizontal grid only, no axis lines, gradient fills via shared <defs>,
 * and container-query degradation for tight cards.
 *
 * Expected data shape:
 *   { points: Record<string, string | number>[],
 *     series: { name: string; color?: string }[],
 *     stacked?: boolean }
 */
import { Alert, Box } from '@mantine/core';
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
import {
  ChartTooltip,
  chartAxisProps,
  chartGridProps,
  ChartSkeleton,
  WidgetContainer,
} from '../chart-primitives';

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

const FALLBACK_ACCENTS = [
  'riokuOrange',
  'riokuInfo',
  'riokuSuccess',
  'riokuWarning',
  'riokuDanger',
];

export function AreaChartWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <ChartSkeleton kind="line" height={200} />;
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

  if (data.points.length === 0) {
    return (
      <Box p="md" ta="center">
        No data in this range. Try widening the time window.
      </Box>
    );
  }

  const seriesWithColor = data.series.map((s, i) => ({
    name: s.name,
    color: s.color ?? FALLBACK_ACCENTS[i % FALLBACK_ACCENTS.length] ?? 'riokuOrange',
  }));

  const stackId = data.stacked === true ? '1' : undefined;
  const showLegend = seriesWithColor.length > 1;

  return (
    <WidgetContainer>
      <Box
        role="img"
        aria-label={`Area chart for ${widget.title}`}
        style={{ width: '100%', height: '100%', minHeight: 140 }}
        className="rioku-chart"
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
                    stopOpacity={0.32}
                  />
                  <stop
                    offset="100%"
                    stopColor={`var(--mantine-color-${s.color}-6)`}
                    stopOpacity={0}
                  />
                </linearGradient>
              ))}
            </defs>
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
            {showLegend && (
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
              />
            )}
            {seriesWithColor.map((s) => (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={`var(--mantine-color-${s.color}-6)`}
                strokeWidth={2}
                fill={`url(#grad-${widget.id}-${s.name})`}
                {...(stackId !== undefined ? { stackId } : {})}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--mantine-color-body)' }}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </WidgetContainer>
  );
}
