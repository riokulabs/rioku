/**
 * <ProgressWidget> — single linear progress bar (or stack of bars).
 *
 * Two display modes:
 *   - single: { value: number; max?: number; label?: string; unit?: string }
 *   - multiple: { items: { name: string; value: number; max?: number; color?: string }[] }
 */
import { Alert, Group, Progress, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface ProgressItem {
  name: string;
  value: number;
  max?: number;
  color?: string;
}

interface ProgressData {
  value?: number;
  max?: number;
  label?: string;
  unit?: string;
  items?: ProgressItem[];
}

function isProgressData(data: unknown): data is ProgressData {
  return typeof data === 'object' && data !== null;
}

const FALLBACK_ACCENT = 'riokuOrange';

export function ProgressWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={80} width="100%" radius="md" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isProgressData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ value } or { items: [] }'}
      </Alert>
    );

  // Multi-bar mode.
  if (Array.isArray(data.items) && data.items.length > 0) {
    return (
      <Stack gap="sm" aria-label={`Progress widget for ${widget.title}`}>
        {data.items.map((item) => {
          const max = item.max ?? 100;
          const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (item.value / max) * 100));
          const color = item.color ?? FALLBACK_ACCENT;
          return (
            <Stack key={item.name} gap={4}>
              <Group gap="xs" justify="space-between">
                <Text size="xs" fw={600} truncate>
                  {item.name}
                </Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {item.value.toLocaleString()} / {max.toLocaleString()}
                </Text>
              </Group>
              <Progress value={pct} color={color} size="md" radius="sm" />
            </Stack>
          );
        })}
      </Stack>
    );
  }

  // Single mode.
  const max = data.max ?? 100;
  const value = data.value ?? 0;
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const label = data.label ?? widget.title;
  const unit = data.unit ?? '';

  return (
    <Stack gap="xs" aria-label={`${label}: ${String(value)} / ${String(max)}`}>
      <Group gap="xs" justify="space-between" align="baseline">
        <Text size="sm" fw={600}>
          {label}
        </Text>
        <Group gap={4} align="baseline">
          <Text fw={700} size="xl">
            {value.toLocaleString()}
          </Text>
          <Text size="xs" c="dimmed">
            {unit ? `${unit} / ` : '/ '}
            {max.toLocaleString()}
            {unit ? ` ${unit}` : ''}
          </Text>
        </Group>
      </Group>
      <Progress value={pct} size="lg" radius="md" color={FALLBACK_ACCENT} />
      <Text size="xs" c="dimmed" ta="right">
        {pct.toFixed(1)}%
      </Text>
    </Stack>
  );
}
