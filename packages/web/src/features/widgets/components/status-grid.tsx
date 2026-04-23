/**
 * <StatusGridWidget> — uniform grid of system-component health tiles.
 *
 * Each tile shows a component name, a colored dot keyed to status, and an
 * optional secondary value (uptime %, version, latency, …). Tiles flex to
 * fill the card so a 2×4 set looks reasonable at any card width.
 *
 * Expected data shape:
 *   { tiles: { name: string; status: 'ok' | 'warn' | 'error' | 'unknown';
 *              value?: string }[] }
 */
import { Alert, Box, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

type TileStatus = 'ok' | 'warn' | 'error' | 'unknown';

interface StatusGridData {
  tiles: { name: string; status: TileStatus; value?: string }[];
}

function isStatusGridData(data: unknown): data is StatusGridData {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { tiles?: unknown }).tiles)
  );
}

const STATUS_COLOR: Record<TileStatus, string> = {
  ok: 'var(--mantine-color-riokuSuccess-6)',
  warn: 'var(--mantine-color-riokuWarning-6)',
  error: 'var(--mantine-color-riokuDanger-6)',
  unknown: 'var(--mantine-color-dimmed)',
};

export function StatusGridWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={160} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isStatusGridData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ tiles: [] }'}
      </Alert>
    );

  const cols = data.tiles.length <= 4 ? 2 : data.tiles.length <= 9 ? 3 : 4;

  return (
    <SimpleGrid
      cols={cols}
      spacing={6}
      style={{ alignContent: 'flex-start' }}
      aria-label={`Status grid for ${widget.title}`}
    >
      {data.tiles.map((t) => (
        <Box
          key={t.name}
          p="xs"
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 6,
            background: 'var(--mantine-color-body)',
          }}
        >
          <Stack gap={2}>
            <Group gap={6} wrap="nowrap" align="center">
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: STATUS_COLOR[t.status],
                  boxShadow: `0 0 6px ${STATUS_COLOR[t.status]}`,
                  flexShrink: 0,
                }}
              />
              <Text size="xs" fw={600} truncate style={{ flex: 1 }}>
                {t.name}
              </Text>
            </Group>
            {t.value !== undefined && (
              <Text size="xs" c="dimmed" ff="monospace" truncate>
                {t.value}
              </Text>
            )}
          </Stack>
        </Box>
      ))}
    </SimpleGrid>
  );
}
