/**
 * <SingleStatWidget> — displays one headline number with optional delta.
 *
 * Expected data shape: { value: number; delta?: number; unit?: string; label?: string }.
 */
import { Alert, Group, Skeleton, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconTrendingDown, IconTrendingUp, IconMinus } from '@tabler/icons-react';
import type { WidgetRenderProps } from '../types';

interface SingleStatData {
  value: number;
  delta?: number;
  unit?: string;
  /** Optional secondary label shown below the value */
  label?: string;
}

function isSingleStatData(data: unknown): data is SingleStatData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'value' in data &&
    typeof (data as { value: unknown }).value === 'number'
  );
}

function formatValue(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (!Number.isInteger(n)) return n.toFixed(2);
  return n.toLocaleString();
}

export function SingleStatWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={72} width={160} radius="sm" />;
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

  const hasDelta = data.delta !== undefined;
  const isUp = hasDelta && (data.delta ?? 0) > 0;
  const isDown = hasDelta && (data.delta ?? 0) < 0;
  const isFlat = hasDelta && (data.delta ?? 0) === 0;

  const deltaColor = isUp ? 'green' : isDown ? 'red' : 'gray';
  const DeltaIcon = isUp ? IconTrendingUp : isDown ? IconTrendingDown : IconMinus;

  const absDelta = Math.abs(data.delta ?? 0);
  const deltaLabel = hasDelta
    ? `${isUp ? '+' : isDown ? '-' : ''}${absDelta.toLocaleString()}${absDelta < 100 && !Number.isInteger(absDelta) ? '' : ''}`
    : null;

  return (
    <Stack gap={2} aria-label={`${widget.title}: ${String(data.value)}`}>
      <Group gap={6} align="baseline" wrap="nowrap">
        <Text
          fw={700}
          style={{ fontSize: 32, lineHeight: 1.1, letterSpacing: '-0.02em' }}
        >
          {formatValue(data.value)}
        </Text>
        {data.unit !== undefined && (
          <Text size="sm" c="dimmed" fw={500}>
            {data.unit}
          </Text>
        )}
      </Group>
      {data.label !== undefined && (
        <Text size="xs" c="dimmed">
          {data.label}
        </Text>
      )}
      {deltaLabel !== null && (
        <Group gap={4} align="center" mt={4}>
          <ThemeIcon size="xs" variant="light" color={deltaColor} radius="xl">
            <DeltaIcon size={10} />
          </ThemeIcon>
          <Text size="xs" c={deltaColor} fw={600}>
            {deltaLabel}
            {!isFlat && ' vs last period'}
          </Text>
        </Group>
      )}
    </Stack>
  );
}
