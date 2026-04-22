/**
 * <SingleStatWidget> — displays one headline number with optional delta.
 *
 * Expected data shape: { value: number; delta?: number; unit?: string }.
 */
import { Alert, Badge, Group, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface SingleStatData {
  value: number;
  delta?: number;
  unit?: string;
}

function isSingleStatData(data: unknown): data is SingleStatData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'value' in data &&
    typeof (data as { value: unknown }).value === 'number'
  );
}

export function SingleStatWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={60} width={140} radius="sm" />;
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

  const deltaColor = data.delta === undefined ? 'gray' : data.delta >= 0 ? 'green' : 'red';
  const deltaLabel =
    data.delta === undefined ? null : `${data.delta >= 0 ? '+' : ''}${String(data.delta)}`;

  return (
    <Stack gap={4} aria-label={`${widget.title}: ${String(data.value)}`}>
      <Group gap="xs" align="baseline">
        <Text fw={700} size="xl">
          {data.value.toLocaleString()}
        </Text>
        {data.unit !== undefined && (
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {data.unit}
          </Text>
        )}
      </Group>
      {deltaLabel !== null && (
        <Badge color={deltaColor} variant="light" size="sm">
          {deltaLabel}
        </Badge>
      )}
    </Stack>
  );
}
