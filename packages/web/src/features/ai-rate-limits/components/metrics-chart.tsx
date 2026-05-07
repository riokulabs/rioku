/**
 * <RateLimitMetricsChart> — full-width LineChart of throttle events per
 * bucket over a configurable lookback window. Backed by the daemon's
 * `/ai/rate-limits/{id}/metrics?since=...` endpoint. Mantine's LineChart
 * is recharts-under-the-hood (see `package.json` → `recharts`).
 */
import { Box, Text } from '@mantine/core';
import { LineChart } from '@mantine/charts';
import { useRateLimitMetricsRaw } from '../api';
import type { MetricWindow } from '../types';

interface RateLimitMetricsChartProps {
  tenantId: string;
  ruleId: string;
  /** Lookback window. Defaults to 24h to match the plan spec. */
  window?: MetricWindow;
  height?: number;
}

const DEFAULT_HEIGHT = 240;

export function RateLimitMetricsChart({
  tenantId,
  ruleId,
  window = '24h',
  height = DEFAULT_HEIGHT,
}: RateLimitMetricsChartProps) {
  const points = useRateLimitMetricsRaw(tenantId, ruleId, window);
  const data = points.map((p) => ({
    timestamp: p.timestamp,
    throttle_events: p.throttle_events,
  }));

  if (data.length === 0) {
    return (
      <Box
        style={{
          width: '100%',
          height,
          background: 'var(--mantine-color-gray-1)',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        data-testid="rate-limit-metrics-empty"
      >
        <Text size="sm" c="var(--mantine-color-gray-7)">
          No throttle events recorded in the last {window}.
        </Text>
      </Box>
    );
  }

  return (
    <Box
      role="img"
      aria-label={`Throttle events over the last ${window} for rule ${ruleId}`}
      data-testid="rate-limit-metrics-chart"
    >
      <LineChart
        h={height}
        data={data}
        dataKey="timestamp"
        series={[{ name: 'throttle_events', color: 'red.6', label: 'Throttle events' }]}
        curveType="monotone"
        withDots={false}
        withTooltip
        strokeWidth={2}
        gridAxis="xy"
      />
    </Box>
  );
}
