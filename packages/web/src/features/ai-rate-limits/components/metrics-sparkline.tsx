/**
 * <MetricsSparkline> — minimal Mantine AreaChart showing match counts per
 * bucket for a rate-limit rule.
 *
 * Sizes:
 *   - `sm`: 100×28 — embedded in DataTable rows.
 *   - `lg`: 100%×120 — drawer detail view.
 *
 * When the rule has no data we still render a fixed-height placeholder so
 * the row height stays stable.
 */
import { Box, Text } from '@mantine/core';
import { AreaChart } from '@mantine/charts';
import { useRateLimitMetrics } from '../api';
import type { MetricWindow } from '../types';

interface MetricsSparklineProps {
  tenantId: string;
  ruleId: string;
  size: 'sm' | 'lg';
  window?: MetricWindow;
}

const SM_WIDTH = 100;
const SM_HEIGHT = 28;
const LG_HEIGHT = 120;

export function MetricsSparkline({
  tenantId,
  ruleId,
  size,
  window = '24h',
}: MetricsSparklineProps) {
  const points = useRateLimitMetrics(tenantId, ruleId, window);

  const isEmpty = points.length === 0;
  const data = points.map((p) => ({
    timestamp: p.timestamp,
    matches: p.matches,
  }));

  if (size === 'sm') {
    if (isEmpty) {
      return (
        <Box
          style={{
            width: SM_WIDTH,
            height: SM_HEIGHT,
            background: 'var(--mantine-color-gray-1)',
            borderRadius: 2,
          }}
          aria-label="No metrics yet"
        />
      );
    }
    return (
      <Box
        role="img"
        aria-label={`Matches sparkline for rule ${ruleId}`}
        style={{ width: SM_WIDTH, height: SM_HEIGHT }}
      >
        <AreaChart
          h={SM_HEIGHT}
          w={SM_WIDTH}
          data={data}
          dataKey="timestamp"
          series={[{ name: 'matches', color: 'blue.6' }]}
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

  // lg
  if (isEmpty) {
    return (
      <Box
        style={{
          width: '100%',
          height: LG_HEIGHT,
          background: 'var(--mantine-color-gray-1)',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text size="xs" c="var(--mantine-color-gray-7)">
          No matches recorded in this window.
        </Text>
      </Box>
    );
  }
  return (
    <Box role="img" aria-label={`Matches chart for rule ${ruleId}`}>
      <AreaChart
        h={LG_HEIGHT}
        data={data}
        dataKey="timestamp"
        series={[{ name: 'matches', color: 'blue.6', label: 'Matches' }]}
        curveType="monotone"
        withGradient
        withTooltip
        withXAxis={false}
        strokeWidth={2}
      />
    </Box>
  );
}
