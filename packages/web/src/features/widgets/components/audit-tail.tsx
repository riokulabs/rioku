/**
 * <AuditTailWidget> — recent audit entries, most-recent first.
 *
 * Expected data shape: { entries: { id: string; at: string; action: string;
 *                                   actor_id: string; outcome: string }[] }.
 */
import { Alert, Badge, Box, Group, ScrollArea, Skeleton, Stack, Text, Tooltip } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actor_id: string;
  /** Expected values: 'success' | 'denied' | 'error'; any string is tolerated. */
  outcome: string;
}

interface AuditTailData {
  entries: AuditEntry[];
}

function isAuditTailData(data: unknown): data is AuditTailData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { entries?: unknown }).entries)
  );
}

const OUTCOME_CONFIG: Record<string, { color: string; label: string }> = {
  success: { color: 'green', label: 'OK' },
  denied:  { color: 'yellow', label: 'DENY' },
  error:   { color: 'red', label: 'ERR' },
};

function getOutcome(o: string): { color: string; label: string } {
  return OUTCOME_CONFIG[o] ?? { color: 'gray', label: o.slice(0, 4).toUpperCase() };
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return ts;
  }
}

/** Shorten an actor ID like "user-0001" to something readable */
function shortActor(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

export function AuditTailWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={220} width="100%" radius="sm" />;
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
      <Text size="sm" c="dimmed" ta="center" py="md">
        No audit entries
      </Text>
    );
  }

  return (
    <ScrollArea.Autosize mah={260} aria-label={`Audit tail for ${widget.title}`}>
      <Stack gap={2}>
        {data.entries.map((e) => {
          const { color, label } = getOutcome(e.outcome);
          return (
            <Box
              key={e.id}
              px={6}
              py={4}
              style={{
                borderRadius: 4,
                borderLeft: `3px solid var(--mantine-color-${color}-5)`,
              }}
            >
              <Group gap={6} wrap="nowrap" align="center">
                <Badge size="xs" color={color} variant="light" style={{ flexShrink: 0, minWidth: 40, textAlign: 'center' }}>
                  {label}
                </Badge>
                <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {formatTs(e.at)}
                </Text>
                <Text size="xs" fw={500} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.action}
                </Text>
                <Tooltip label={e.actor_id} withArrow position="top">
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: 'nowrap', cursor: 'default' }}>
                    {shortActor(e.actor_id)}
                  </Text>
                </Tooltip>
              </Group>
            </Box>
          );
        })}
      </Stack>
    </ScrollArea.Autosize>
  );
}
