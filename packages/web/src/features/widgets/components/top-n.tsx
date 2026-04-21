/**
 * <TopNWidget> — ranked list with proportional value bars.
 *
 * Expected data shape: { items: { name: string; value: number; unit?: string }[] }.
 */
import { Alert, Box, Group, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface TopNItem {
  name: string;
  value: number;
  unit?: string;
}

interface TopNData {
  items: TopNItem[];
}

function isTopNData(data: unknown): data is TopNData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { items?: unknown }).items)
  );
}

/** Zipf-ish rank colours: top entries are warmer. */
function rankColor(rank: number, total: number): string {
  if (total <= 1) return 'blue';
  const pct = rank / (total - 1);
  if (pct < 0.2) return 'blue';
  if (pct < 0.5) return 'teal';
  if (pct < 0.75) return 'cyan';
  return 'gray';
}

function formatValue(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
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

  const items = data.items.slice(0, 10);
  const max = items.reduce((m, it) => (it.value > m ? it.value : m), 0);

  return (
    <Stack gap={6} aria-label={`Top-N ranking for ${widget.title}`}>
      {items.map((it, i) => {
        const pct = max === 0 ? 0 : (it.value / max) * 100;
        const color = rankColor(i, items.length);
        return (
          <Box key={`${it.name}-${String(i)}`}>
            <Group gap="xs" wrap="nowrap" mb={3}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                style={{ width: 18, textAlign: 'right', flexShrink: 0 }}
              >
                {i + 1}
              </Text>
              <Text size="xs" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.name}
              </Text>
              <Text size="xs" fw={600} ff="monospace" style={{ flexShrink: 0 }}>
                {formatValue(it.value)}{it.unit !== undefined ? ` ${it.unit}` : ''}
              </Text>
            </Group>
            <Box style={{ height: 4, borderRadius: 2, background: 'var(--mantine-color-dark-5)', overflow: 'hidden' }}>
              <Box
                style={{
                  height: '100%',
                  width: `${String(pct)}%`,
                  background: `var(--mantine-color-${color}-5)`,
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }}
              />
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
