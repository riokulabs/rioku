/**
 * <KpiCardWidget> — hero stat tile with delta pill + full-bleed sparkline.
 *
 * Premium layout: large tabular-nums headline, DeltaPill with "vs prev"
 * suffix, optional subtitle in muted text, and a gradient-filled sparkline
 * that fills the bottom of the card. Sparkline baseline anchored to the
 * data's min (not zero) so the trend reads as articulated motion.
 *
 * Expected data shape:
 *   { value: number, unit?: string, subtitle?: string, delta?: number,
 *     trend?: number[], accent?: string, inverseDelta?: boolean }
 */
import { Alert, Box, Group, Stack, Text } from '@mantine/core';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { WidgetRenderProps } from '../types';
import { ChartSkeleton, DeltaPill } from '../chart-primitives';

interface KpiCardData {
  value: number;
  unit?: string;
  subtitle?: string;
  delta?: number;
  trend?: number[];
  accent?: string;
  /**
   * When true, a positive delta is BAD (e.g. error rate, latency).
   * Default: positive delta is GOOD (e.g. throughput, cache hit rate).
   */
  inverseDelta?: boolean;
}

function isKpiCardData(data: unknown): data is KpiCardData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'value' in data &&
    typeof (data as { value: unknown }).value === 'number'
  );
}

function formatValue(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}

export function KpiCardWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <ChartSkeleton kind="kpi" height={90} />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isKpiCardData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ value: number }'}
      </Alert>
    );

  const accent = data.accent ?? 'riokuOrange';
  const accentVar = `var(--mantine-color-${accent}-6)`;
  const gradientId = `kpi-grad-${widget.id}`;

  const trend = data.trend ?? [];
  const chartData = trend.map((y, i) => ({ i, y }));
  // Baseline at data min, not 0, so the sparkline reads as articulated
  // movement instead of "tiny line near the top of the box".
  const minY = chartData.length > 0 ? Math.min(...chartData.map((d) => d.y)) : 0;
  const maxY = chartData.length > 0 ? Math.max(...chartData.map((d) => d.y)) : 1;

  return (
    <Stack
      gap={6}
      h="100%"
      aria-label={`${widget.title}: ${formatValue(data.value)}`}
      style={{ position: 'relative' }}
    >
      <Group gap={6} align="baseline" wrap="nowrap">
        <Text
          fw={700}
          fz={28}
          lh={1.1}
          style={{ letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatValue(data.value)}
        </Text>
        {data.unit !== undefined && (
          <Text size="sm" c="dimmed" fw={500}>
            {data.unit}
          </Text>
        )}
      </Group>

      {(data.delta !== undefined || data.subtitle !== undefined) && (
        <Group gap="xs" wrap="nowrap">
          {data.delta !== undefined && (
            <DeltaPill
              value={data.delta}
              inverse={data.inverseDelta === true}
              suffix={data.subtitle === undefined ? 'vs prev' : ''}
            />
          )}
          {data.subtitle !== undefined && (
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.4 }} truncate>
              {data.subtitle}
            </Text>
          )}
        </Group>
      )}

      {chartData.length >= 2 && (
        <Box style={{ flex: 1, minHeight: 36, marginTop: 4 }}>
          <ResponsiveContainer width="100%" height="100%" minHeight={32}>
            <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentVar} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={accentVar} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="y"
                stroke={accentVar}
                strokeWidth={1.75}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
                baseValue={minY === maxY ? 0 : minY}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Stack>
  );
}
