/**
 * <SingleStatWidget> — one headline number with an optional delta pill.
 *
 * Uses the shared <DeltaPill>. Tabular-nums on the headline so digits
 * don't jitter as data refreshes.
 *
 * Expected data shape: { value: number; delta?: number; unit?: string }.
 */
import { Alert, Group, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';
import { ChartSkeleton, DeltaPill } from '../chart-primitives';

interface SingleStatData {
  value: number;
  delta?: number;
  unit?: string;
  inverseDelta?: boolean;
}

function isSingleStatData(data: unknown): data is SingleStatData {
  return (
    typeof data === 'object' && data !== null && 'value' in data && typeof data.value === 'number'
  );
}

export function SingleStatWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <ChartSkeleton kind="kpi" height={64} />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isSingleStatData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ value: number }'}
      </Alert>
    );

  return (
    <Stack gap={4} aria-label={`${widget.title}: ${String(data.value)}`}>
      <Group gap="xs" align="baseline">
        <Text
          fw={700}
          size="xl"
          style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
        >
          {data.value.toLocaleString()}
        </Text>
        {data.unit !== undefined && (
          <Text size="sm" c="dimmed">
            {data.unit}
          </Text>
        )}
      </Group>
      {data.delta !== undefined && (
        <DeltaPill value={data.delta} inverse={data.inverseDelta === true} />
      )}
    </Stack>
  );
}
