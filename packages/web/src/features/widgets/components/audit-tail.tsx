/**
 * <AuditTailWidget> — recent audit entries, most-recent first.
 *
 * Expected data shape: { entries: { id: string; at: string; action: string;
 *                                   actor_id: string; outcome: string }[] }.
 */
import { Alert, Badge, Group, ScrollArea, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface AuditTailData {
  entries: {
    id: string;
    at: string;
    action: string;
    actor_id: string;
    outcome: 'success' | 'denied' | 'error' | string;
  }[];
}

function isAuditTailData(data: unknown): data is AuditTailData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { entries?: unknown }).entries)
  );
}

function outcomeColor(o: string): string {
  if (o === 'success') return 'green';
  if (o === 'denied') return 'yellow';
  if (o === 'error') return 'red';
  return 'gray';
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

  return (
    <ScrollArea.Autosize mah={240} aria-label={`Audit tail for ${widget.title}`}>
      <Stack gap={4}>
        {data.entries.map((e) => (
          <Group key={e.id} gap="xs" wrap="nowrap">
            <Badge size="xs" color={outcomeColor(e.outcome)} variant="light">
              {e.outcome}
            </Badge>
            <Text size="xs" c="var(--mantine-color-gray-7)" style={{ whiteSpace: 'nowrap' }}>
              {e.at}
            </Text>
            <Text size="xs" fw={500}>
              {e.action}
            </Text>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              {e.actor_id}
            </Text>
          </Group>
        ))}
      </Stack>
    </ScrollArea.Autosize>
  );
}
