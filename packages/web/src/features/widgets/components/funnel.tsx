/**
 * <FunnelWidget> — conversion funnel with proportional segments.
 *
 * Hand-rolled (not recharts.FunnelChart) so segment widths reflect each
 * stage's value proportional to the previous stage, and per-stage
 * conversion / drop-off are rendered inline. This gives a tighter,
 * narrower-card-friendly layout than recharts' default funnel.
 *
 * Expected data shape: { stages: { name: string; value: number; color?: string }[] }.
 */
import { Alert, Box, Group, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface FunnelData {
  stages: { name: string; value: number; color?: string }[];
}

function isFunnelData(data: unknown): data is FunnelData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { stages?: unknown }).stages)
  );
}

const FALLBACK_ACCENTS = [
  'riokuOrange',
  'riokuInfo',
  'riokuSuccess',
  'riokuWarning',
  'riokuDanger',
];

export function FunnelWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={200} width="100%" radius="md" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isFunnelData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ stages: [] }'}
      </Alert>
    );

  if (data.stages.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No stages.
      </Text>
    );
  }

  const top = data.stages[0]?.value ?? 1;
  return (
    <Stack gap="xs" aria-label={`Funnel for ${widget.title}`}>
      {data.stages.map((stage, i) => {
        const widthPct = top === 0 ? 0 : (stage.value / top) * 100;
        const prev = i === 0 ? null : data.stages[i - 1];
        const conversion =
          prev && prev.value !== 0 ? ((stage.value / prev.value) * 100).toFixed(1) : null;
        const accent = stage.color ?? FALLBACK_ACCENTS[i % FALLBACK_ACCENTS.length] ?? 'riokuOrange';
        const bg = `var(--mantine-color-${accent}-6)`;
        return (
          <Stack key={stage.name} gap={2}>
            <Group gap="xs" justify="space-between" wrap="nowrap">
              <Text size="xs" fw={600} truncate>
                {stage.name}
              </Text>
              <Group gap={6} wrap="nowrap">
                {conversion !== null && (
                  <Text size="xs" c="dimmed">
                    {conversion}%
                  </Text>
                )}
                <Text size="xs" ff="monospace">
                  {stage.value.toLocaleString()}
                </Text>
              </Group>
            </Group>
            <Box
              style={{
                height: 14,
                borderRadius: 4,
                background: 'var(--mantine-color-default-hover)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Box
                aria-hidden
                style={{
                  width: `${String(widthPct)}%`,
                  height: '100%',
                  background: bg,
                  transition: 'width 200ms ease',
                  borderRadius: 4,
                }}
              />
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}
