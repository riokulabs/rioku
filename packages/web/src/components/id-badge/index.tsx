import { CopyButton, Tooltip, ActionIcon, Group, Text } from '@mantine/core';
import { IconCopy, IconCheck } from '@tabler/icons-react';

export interface IdBadgeProps {
  /** The full ID to copy to clipboard */
  id: string;
  /**
   * Optional display label. When omitted the badge shows a truncated form:
   * first 6 chars … last 4 chars.
   */
  label?: string;
}

function truncate(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function IdBadge({ id, label }: IdBadgeProps) {
  const display = label ?? truncate(id);

  return (
    <CopyButton value={id} timeout={2000}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? 'Copied' : `Copy ${id}`} withArrow>
          <Group gap={4} wrap="nowrap" style={{ display: 'inline-flex' }}>
            <Text
              component="span"
              size="sm"
              ff="monospace"
              c="dimmed"
              style={{ userSelect: 'all' }}
            >
              {display}
            </Text>
            <ActionIcon
              size="xs"
              variant="subtle"
              color={copied ? 'teal' : 'gray'}
              onClick={copy}
              aria-label="Copy ID"
            >
              {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
            </ActionIcon>
          </Group>
        </Tooltip>
      )}
    </CopyButton>
  );
}
