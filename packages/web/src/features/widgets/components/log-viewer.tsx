/**
 * <LogViewerWidget> — scrollable list of recent log entries.
 *
 * Expected data shape: { lines: { level: 'debug'|'info'|'warn'|'error'; ts: string; msg: string }[] }.
 */
import { Alert, ScrollArea, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface LogViewerData {
  lines: { level: 'debug' | 'info' | 'warn' | 'error'; ts: string; msg: string }[];
}

function isLogViewerData(data: unknown): data is LogViewerData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { lines?: unknown }).lines)
  );
}

const LEVEL_COLORS: Record<'debug' | 'info' | 'warn' | 'error', string> = {
  debug: 'var(--mantine-color-gray-7)',
  info: 'var(--mantine-color-blue-7)',
  warn: 'var(--mantine-color-yellow-8)',
  error: 'var(--mantine-color-red-7)',
};

export function LogViewerWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={200} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isLogViewerData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ lines: [] }'}
      </Alert>
    );

  return (
    <ScrollArea.Autosize mah={240} aria-label={`Log viewer for ${widget.title}`}>
      <Stack gap={2} style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>
        {data.lines.map((l, i) => (
          <Text key={i} size="xs" c={LEVEL_COLORS[l.level]}>
            [{l.ts}] {l.level.toUpperCase()} {l.msg}
          </Text>
        ))}
      </Stack>
    </ScrollArea.Autosize>
  );
}
