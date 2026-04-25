/**
 * <AuditTailWidget> — recent audit entries, most-recent first.
 *
 * Polished as a tight timeline: each entry has a colored outcome dot on a
 * vertical rail, relative timestamp, action verb (bold), and actor (dimmed).
 * Compact density — fits ~10 entries in a 6-row card without scrolling.
 *
 * Expected data shape:
 *   { entries: { id: string; at: string; action: string; actor_id: string;
 *                outcome: string }[] }.
 */
import { Alert, Box, Group, ScrollArea, Skeleton, Stack, Text, Tooltip } from '@mantine/core';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { WidgetRenderProps } from '../types';

dayjs.extend(relativeTime);

interface AuditTailData {
  entries: {
    id: string;
    at: string;
    action: string;
    actor_id: string;
    /** Expected values: 'success' | 'denied' | 'error'; any string is tolerated. */
    outcome: string;
  }[];
}

function isAuditTailData(data: unknown): data is AuditTailData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { entries?: unknown }).entries)
  );
}

function outcomeMeta(o: string): { color: string; label: string } {
  if (o === 'success') return { color: 'var(--mantine-color-riokuSuccess-6)', label: 'OK' };
  if (o === 'denied') return { color: 'var(--mantine-color-riokuWarning-6)', label: 'DENIED' };
  if (o === 'error') return { color: 'var(--mantine-color-riokuDanger-6)', label: 'ERROR' };
  return { color: 'var(--mantine-color-gray-6)', label: o.toUpperCase() };
}

export function AuditTailWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={200} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isAuditTailData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ entries: [] }'}
      </Alert>
    );

  if (data.entries.length === 0) {
    return (
      <Box p="md">
        <Text size="sm" c="dimmed" ta="center">
          No audit entries in this range.
        </Text>
      </Box>
    );
  }

  return (
    <ScrollArea h="100%" type="hover" offsetScrollbars aria-label={`Audit tail for ${widget.title}`}>
      <Stack gap={0} pl={8} style={{ position: 'relative' }}>
        {/* Vertical rail */}
        <Box
          aria-hidden
          style={{
            position: 'absolute',
            left: 11,
            top: 6,
            bottom: 6,
            width: 1,
            background: 'var(--mantine-color-default-border)',
          }}
        />
        {data.entries.map((e) => {
          const meta = outcomeMeta(e.outcome);
          const at = dayjs(e.at);
          const relative = at.isValid() ? at.fromNow() : e.at;
          const absolute = at.isValid() ? at.format('YYYY-MM-DD HH:mm:ss') : e.at;
          return (
            <Group
              key={e.id}
              gap="xs"
              wrap="nowrap"
              align="center"
              py={4}
              pr="xs"
              style={{ position: 'relative', transition: 'background 80ms linear' }}
              onMouseEnter={(ev) => {
                ev.currentTarget.style.background = 'var(--mantine-color-default-hover)';
              }}
              onMouseLeave={(ev) => {
                ev.currentTarget.style.background = 'transparent';
              }}
            >
              {/* Outcome dot anchored to rail */}
              <Tooltip label={meta.label} withArrow>
                <Box
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: meta.color,
                    boxShadow: `0 0 0 3px var(--mantine-color-body), 0 0 6px ${meta.color}`,
                    flexShrink: 0,
                    marginLeft: -1,
                  }}
                />
              </Tooltip>
              <Tooltip label={absolute} withArrow>
                <Text
                  size="xs"
                  c="dimmed"
                  ff="monospace"
                  w={68}
                  style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
                >
                  {relative}
                </Text>
              </Tooltip>
              <Text size="xs" fw={600} truncate style={{ flex: 1, minWidth: 0 }}>
                {e.action}
              </Text>
              <Text size="xs" c="dimmed" truncate style={{ maxWidth: 120 }}>
                {e.actor_id}
              </Text>
            </Group>
          );
        })}
      </Stack>
    </ScrollArea>
  );
}
