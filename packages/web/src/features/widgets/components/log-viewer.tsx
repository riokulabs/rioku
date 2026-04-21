/**
 * <LogViewerWidget> — scrollable list of recent log entries.
 *
 * Expected data shape: { lines: { level: 'debug'|'info'|'warn'|'error'; ts: string; msg: string }[] }.
 */
import { Alert, Badge, Group, ScrollArea, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  ts: string;
  msg: string;
}

interface LogViewerData {
  lines: LogLine[];
}

function isLogViewerData(data: unknown): data is LogViewerData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { lines?: unknown }).lines)
  );
}

const LEVEL_CONFIG: Record<LogLine['level'], { color: string; short: string }> = {
  debug: { color: 'gray', short: 'DBG' },
  info:  { color: 'blue', short: 'INF' },
  warn:  { color: 'yellow', short: 'WRN' },
  error: { color: 'red', short: 'ERR' },
};

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

export function LogViewerWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={220} width="100%" radius="sm" />;
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

  if (data.lines.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="md" ff="monospace">
        No log entries
      </Text>
    );
  }

  return (
    <ScrollArea.Autosize
      mah={260}
      aria-label={`Log viewer for ${widget.title}`}
      style={{ background: 'var(--mantine-color-dark-8)', borderRadius: 6, padding: '8px 4px' }}
    >
      <Stack gap={1} style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>
        {data.lines.map((l, i) => {
          const cfg = LEVEL_CONFIG[l.level];
          return (
            <Group key={i} gap={6} wrap="nowrap" px={6} py={2} style={{ alignItems: 'flex-start' }}>
              <Badge
                size="xs"
                color={cfg.color}
                variant="filled"
                style={{ flexShrink: 0, minWidth: 34, textAlign: 'center', fontFamily: 'monospace' }}
              >
                {cfg.short}
              </Badge>
              <Text
                size="xs"
                c="dimmed"
                ff="monospace"
                style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {formatTs(l.ts)}
              </Text>
              <Text
                size="xs"
                ff="monospace"
                c={l.level === 'error' ? 'red.4' : l.level === 'warn' ? 'yellow.4' : 'gray.3'}
                style={{ flex: 1, wordBreak: 'break-all' }}
              >
                {l.msg}
              </Text>
            </Group>
          );
        })}
      </Stack>
    </ScrollArea.Autosize>
  );
}
