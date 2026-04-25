/**
 * <SparklineWidget> — minimal trend line, no axes, no tooltip.
 *
 * Hand-rolled with recharts directly so the gradient fill matches our chart
 * primitives (Mantine's AreaChart wrapper doesn't expose enough control).
 *
 * Expected data shape: { points: { x: string|number; y: number }[] }.
 */
import { Alert, Box } from '@mantine/core';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import type { WidgetRenderProps } from '../types';
import { ChartSkeleton } from '../chart-primitives';

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
  if (loading) return <ChartSkeleton kind="sparkline" height={56} />;
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

  const stroke = 'var(--mantine-color-riokuInfo-6)';
  const gradientId = `spark-${widget.id}`;
  const chartData = data.points.map((p, i) => ({ i, y: p.y }));

  return (
    <Box
      role="img"
      aria-label={`Sparkline for ${widget.title}`}
      style={{ width: '100%', height: '100%', minHeight: 40 }}
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={40}>
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Domain anchored to data min/max so trend is articulated. */}
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="y"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
