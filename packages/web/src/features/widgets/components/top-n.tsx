/**
 * <TopNWidget> — ranked list with proportional value bars.
 *
 * Uses an accent-tinted gradient bar keyed to `widget.config.accent` so the
 * bars are readable on dark cards (the previous blue-1 fill resolved to a
 * near-black navy in our dark theme and was effectively invisible).
 *
 * Expected data shape: { items: { name: string; value: number }[] }.
 */
import { Alert, Box, Group, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface TopNData {
  items: { name: string; value: number }[];
}

function isTopNData(data: unknown): data is TopNData {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { items?: unknown }).items)
  );
}

export function TopNWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={200} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isTopNData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ items: [] }'}
      </Alert>
    );

  const accent = typeof widget.config.accent === 'string' ? widget.config.accent : 'riokuInfo';
  const accentVar = `var(--mantine-color-${accent}-6)`;
  const max = data.items.reduce((m, it) => (it.value > m ? it.value : m), 0);

  return (
    <Stack gap={6} aria-label={`Top-N ranking for ${widget.title}`}>
      {data.items.map((it, i) => {
        const pct = max === 0 ? 0 : (it.value / max) * 100;
        return (
          <Group
            key={`${it.name}-${String(i)}`}
            gap="xs"
            wrap="nowrap"
            style={{ position: 'relative' }}
          >
            <Text size="xs" fw={600} w={24} c="dimmed" ff="monospace">
              #{i + 1}
            </Text>
            <Box style={{ flex: 1, position: 'relative', height: 22 }}>
              {/* Track */}
              <Box
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'var(--mantine-color-default-hover)',
                  borderRadius: 4,
                  opacity: 0.5,
                }}
              />
              {/* Bar */}
              <Box
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: '100%',
                  width: `${pct.toFixed(1)}%`,
                  background: `linear-gradient(90deg, ${accentVar} 0%, color-mix(in srgb, ${accentVar} 60%, transparent) 100%)`,
                  borderRadius: 4,
                  opacity: 0.55,
                }}
              />
              <Text
                size="xs"
                ff="monospace"
                style={{
                  position: 'relative',
                  paddingLeft: 8,
                  lineHeight: '22px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {it.name}
              </Text>
            </Box>
            <Text size="xs" fw={600} ff="monospace" style={{ minWidth: 52, textAlign: 'right' }}>
              {it.value.toLocaleString()}
            </Text>
          </Group>
        );
      })}
    </Stack>
  );
}
