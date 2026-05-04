/**
 * <LogViewerWidget> — scrollable list of recent log entries.
 *
 * Polished layout: each line has a left colored rail (level), monospace
 * relative timestamp, level chip (uppercase, tiny), and the message. Hover
 * highlights the row. Newest line is visually grouped at the top with a
 * subtle "fresh" indicator.
 *
 * Expected data shape:
 *   { lines: { level: 'debug'|'info'|'warn'|'error'; ts: string; msg: string }[] }.
 */
import { Alert, Box, Group, ScrollArea, Skeleton, Text } from '@mantine/core';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { WidgetRenderProps } from '../types';

dayjs.extend(relativeTime);

interface LogViewerData {
  lines: { level: 'debug' | 'info' | 'warn' | 'error'; ts: string; msg: string }[];
}

function isLogViewerData(data: unknown): data is LogViewerData {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { lines?: unknown }).lines)
  );
}

const LEVEL_RAIL: Record<'debug' | 'info' | 'warn' | 'error', string> = {
  debug: 'var(--mantine-color-gray-6)',
  info: 'var(--mantine-color-riokuInfo-6)',
  warn: 'var(--mantine-color-riokuWarning-6)',
  error: 'var(--mantine-color-riokuDanger-6)',
};

const LEVEL_TEXT: Record<'debug' | 'info' | 'warn' | 'error', string> = {
  debug: 'var(--mantine-color-gray-6)',
  info: 'var(--mantine-color-riokuInfo-6)',
  warn: 'var(--mantine-color-riokuWarning-6)',
  error: 'var(--mantine-color-riokuDanger-6)',
};

function tsLabel(ts: string): string {
  const d = dayjs(ts);
  if (!d.isValid()) return ts;
  return d.fromNow(true);
}

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

  if (data.lines.length === 0) {
    return (
      <Box p="md">
        <Text size="sm" c="dimmed" ta="center">
          No log lines in this range.
        </Text>
      </Box>
    );
  }

  return (
    <ScrollArea
      h="100%"
      type="hover"
      offsetScrollbars
      aria-label={`Log viewer for ${widget.title}`}
    >
      <Box>
        {data.lines.map((l, i) => (
          <Group
            key={i}
            gap="xs"
            wrap="nowrap"
            align="flex-start"
            px="xs"
            py={4}
            style={{
              borderLeft: `2px solid ${LEVEL_RAIL[l.level]}`,
              transition: 'background 80ms linear',
              fontSize: 11,
              fontFamily: 'var(--mantine-font-family-monospace)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--mantine-color-default-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Text
              size="xs"
              ff="monospace"
              c="dimmed"
              w={48}
              style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
            >
              {tsLabel(l.ts)}
            </Text>
            <Text
              size="xs"
              fw={700}
              w={42}
              style={{ flexShrink: 0, color: LEVEL_TEXT[l.level], letterSpacing: '0.04em' }}
            >
              {l.level.toUpperCase()}
            </Text>
            <Text size="xs" style={{ wordBreak: 'break-word', flex: 1 }}>
              {l.msg}
            </Text>
          </Group>
        ))}
      </Box>
    </ScrollArea>
  );
}
