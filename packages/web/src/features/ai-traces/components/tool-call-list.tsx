/**
 * <ToolCallList> — Mantine <Timeline> of tool calls for a single trace.
 *
 * Each entry shows:
 *   - Tool name (monospace), status Badge, latency_ms
 *   - Collapsible arguments + result (rendered as JSON via <CodeBlock>)
 *   - Error message when the tool call failed
 *
 * Empty state renders a short note instead of the timeline for clarity.
 */
import { useState } from 'react';
import { Badge, Button, Collapse, Group, Stack, Text, Timeline } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconTool,
  IconAlertTriangle,
  IconCheck,
  IconClock,
} from '@tabler/icons-react';
import { CodeBlock } from '@/components/code-block';
import type { AiTraceToolCall } from '@/api/resources';

const STATUS_COLOR: Record<AiTraceToolCall['status'], string> = {
  success: 'green',
  error: 'red',
  timeout: 'yellow',
};

function statusIcon(status: AiTraceToolCall['status']) {
  if (status === 'success') return <IconCheck size={12} />;
  if (status === 'timeout') return <IconClock size={12} />;
  return <IconAlertTriangle size={12} />;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface ToolCallItemProps {
  call: AiTraceToolCall;
}

function ToolCallItem({ call }: ToolCallItemProps) {
  const [opened, setOpened] = useState(false);
  return (
    <Stack gap={4}>
      <Group gap="xs" align="center" wrap="wrap">
        <Text size="sm" ff="monospace" fw={500}>
          {call.tool_name}
        </Text>
        <Badge
          size="xs"
          variant="light"
          color={STATUS_COLOR[call.status]}
          leftSection={statusIcon(call.status)}
        >
          {call.status}
        </Badge>
        <Text size="xs" c="var(--mantine-color-gray-7)" ff="monospace">
          {String(call.latency_ms)}ms
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={opened ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          onClick={() => {
            setOpened((v) => !v);
          }}
          aria-label={`Toggle details for ${call.tool_name}`}
        >
          {opened ? 'Hide' : 'Show'} payload
        </Button>
      </Group>
      {call.error_message && (
        <Text size="xs" c="red" role="alert">
          {call.error_message}
        </Text>
      )}
      <Collapse expanded={opened}>
        <Stack gap="xs" mt={4}>
          <CodeBlock
            title="arguments"
            code={safeStringify(call.arguments)}
            language="json"
            maxHeight={180}
          />
          <CodeBlock
            title="result"
            code={safeStringify(call.result)}
            language="json"
            maxHeight={180}
          />
        </Stack>
      </Collapse>
    </Stack>
  );
}

interface ToolCallListProps {
  calls: readonly AiTraceToolCall[];
}

export function ToolCallList({ calls }: ToolCallListProps) {
  if (calls.length === 0) {
    return (
      <Text size="xs" c="var(--mantine-color-gray-7)">
        No tool calls recorded for this trace.
      </Text>
    );
  }

  return (
    <Timeline
      active={calls.length - 1}
      bulletSize={22}
      lineWidth={2}
      data-testid="tool-call-timeline"
    >
      {calls.map((call, i) => (
        <Timeline.Item
          key={`${String(i)}-${call.tool_id}`}
          bullet={<IconTool size={12} />}
          color={STATUS_COLOR[call.status]}
          title={
            <Text size="sm" ff="monospace">
              {call.tool_name}
            </Text>
          }
        >
          <ToolCallItem call={call} />
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
