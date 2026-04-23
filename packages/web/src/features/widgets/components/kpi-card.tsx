/**
 * <KpiCardWidget> — hero stat tile with inline trend sparkline.
 *
 * Renders a large headline value, unit suffix, optional subtitle, delta pill,
 * and a sparkline that fills the card's right half. The sparkline is drawn
 * with recharts directly so the fill gradient and stroke weight match the
 * card's accent color — Mantine's AreaChart does not expose that control.
 *
 * Expected data shape:
 *   { value: number, unit?: string, subtitle?: string, delta?: number,
 *     trend?: number[], accent?: string }
 *
 * `accent` is any Mantine color name (resolved to --mantine-color-<name>-6);
 * it drives the sparkline stroke + gradient and the delta pill tint.
 */
import { Alert, Badge, Box, Group, Skeleton, Stack, Text } from '@mantine/core';
import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { WidgetRenderProps } from '../types';

interface KpiCardData {
  value: number;
  unit?: string;
  subtitle?: string;
  delta?: number;
  trend?: number[];
  accent?: string;
  /**
   * When true, a positive delta is BAD (e.g. error rate, failed-auth count,
   * latency). The up-arrow renders red and down-arrow renders green.
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
  if (loading) return <Skeleton height={90} width="100%" radius="sm" />;
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

  const positiveIsGood = data.inverseDelta !== true;
  const deltaIsPositive = data.delta !== undefined && data.delta >= 0;
  const deltaColor =
    data.delta === undefined
      ? 'gray'
      : (deltaIsPositive ? positiveIsGood : !positiveIsGood)
        ? 'riokuSuccess'
        : 'riokuDanger';
  const deltaLabel =
    data.delta === undefined
      ? null
      : `${data.delta >= 0 ? '+' : ''}${data.delta.toFixed(Math.abs(data.delta) < 10 ? 1 : 0)}%`;

  const trend = data.trend ?? [];
  const chartData = trend.map((y, i) => ({ i, y }));

  return (
    <Stack
      gap={6}
      h="100%"
      aria-label={`${widget.title}: ${formatValue(data.value)}`}
      style={{ position: 'relative' }}
    >
      <Group gap={6} align="baseline" wrap="nowrap">
        <Text fw={700} fz={28} lh={1.1} style={{ letterSpacing: '-0.02em' }}>
          {formatValue(data.value)}
        </Text>
        {data.unit !== undefined && (
          <Text size="sm" c="dimmed" fw={500}>
            {data.unit}
          </Text>
        )}
      </Group>

      <Group gap="xs" wrap="nowrap">
        {deltaLabel !== null && (
          <Badge
            size="sm"
            color={deltaColor}
            variant="light"
            leftSection={
              data.delta !== undefined && data.delta >= 0 ? (
                <IconTrendingUp size={12} />
              ) : (
                <IconTrendingDown size={12} />
              )
            }
          >
            {deltaLabel}
          </Badge>
        )}
        {data.subtitle !== undefined && (
          <Text size="xs" c="dimmed" style={{ lineHeight: 1.4 }}>
            {data.subtitle}
          </Text>
        )}
      </Group>

      {chartData.length >= 2 && (
        <Box style={{ flex: 1, minHeight: 40, marginTop: 4 }}>
          <ResponsiveContainer width="100%" height="100%" minHeight={40}>
            <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentVar} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={accentVar} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="y"
                stroke={accentVar}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Stack>
  );
}
