/**
 * <TopNWidget> — ranked list with proportional value bars.
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

  const max = data.items.reduce((m, it) => (it.value > m ? it.value : m), 0);

  return (
    <Stack gap={4} aria-label={`Top-N ranking for ${widget.title}`}>
      {data.items.map((it, i) => {
        const pct = max === 0 ? 0 : Math.round((it.value / max) * 100);
        return (
          <Group
            key={`${it.name}-${String(i)}`}
            gap="xs"
            wrap="nowrap"
            style={{ position: 'relative' }}
          >
            <Text size="xs" fw={600} w={20} c="var(--mantine-color-gray-7)">
              #{i + 1}
            </Text>
            <Box style={{ flex: 1, position: 'relative', height: 20 }}>
              <Box
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: '100%',
                  width: `${String(pct)}%`,
                  background: 'var(--mantine-color-blue-1)',
                  borderRadius: 2,
                }}
              />
              <Text size="xs" style={{ position: 'relative', paddingLeft: 6, lineHeight: '20px' }}>
                {it.name}
              </Text>
            </Box>
            <Text size="xs" fw={500}>
              {it.value.toLocaleString()}
            </Text>
          </Group>
        );
      })}
    </Stack>
  );
}
