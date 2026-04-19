/**
 * column-helpers.tsx — Common cell renderers for <DataTable> column definitions.
 *
 * Keeps feature pages from duplicating timestamp formatting, status badges, and
 * action menus. Import these as building blocks when defining ColumnDef arrays.
 */

import { Badge, Group, ActionIcon, Text, Tooltip } from '@mantine/core';
import { IconDots } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

// ── StatusCell ───────────────────────────────────────────────────────────────

export interface StatusCellProps {
  status: string;
  /** Map of status string → Mantine color. Unmapped statuses get 'gray'. */
  colorMap?: Record<string, string>;
}

const DEFAULT_STATUS_COLORS: Record<string, string> = {
  active: 'green',
  enabled: 'green',
  healthy: 'green',
  inactive: 'gray',
  disabled: 'gray',
  pending: 'yellow',
  warning: 'yellow',
  error: 'red',
  failed: 'red',
  degraded: 'orange',
};

export function StatusCell({ status, colorMap }: StatusCellProps) {
  const merged = { ...DEFAULT_STATUS_COLORS, ...colorMap };
  const color = merged[status.toLowerCase()] ?? 'gray';

  return (
    <Badge color={color} variant="light" size="sm" radius="sm">
      {status}
    </Badge>
  );
}

// ── TimestampCell ────────────────────────────────────────────────────────────

export interface TimestampCellProps {
  /** ISO 8601 string or Date or unix ms number. */
  value: string | Date | number | null | undefined;
  /** Display format. 'relative' shows "3 hours ago". 'absolute' shows locale datetime. Default: 'relative'. */
  format?: 'relative' | 'absolute';
}

export function TimestampCell({ value, format = 'relative' }: TimestampCellProps) {
  if (value == null || value === '') {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    );
  }

  const d = dayjs(value);
  if (!d.isValid()) {
    return (
      <Text size="sm" c="dimmed">
        invalid date
      </Text>
    );
  }

  const display = format === 'relative' ? d.fromNow() : d.format('YYYY-MM-DD HH:mm:ss');
  const title = d.format('YYYY-MM-DD HH:mm:ss [UTC]Z');

  return (
    <Tooltip label={title} withArrow>
      <Text size="sm" style={{ cursor: 'default' }}>
        {display}
      </Text>
    </Tooltip>
  );
}

// ── ActionsCell ──────────────────────────────────────────────────────────────

export interface ActionItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color?: string;
}

export interface ActionsCellProps {
  actions: ActionItem[];
  /** Accessible label for the menu trigger button. */
  label?: string;
}

/**
 * ActionsCell renders an overflow button. For stage 1, it shows a simple
 * tooltip listing available actions rather than a full dropdown menu, which
 * keeps the dependency surface small.
 *
 * NOTE: Stage 2 upgrade — replace with Mantine <Menu> for a real dropdown.
 */
export function ActionsCell({ actions, label = 'Row actions' }: ActionsCellProps) {
  const actionLabels = actions.map((a) => a.label).join(', ');

  return (
    <Group gap={4} wrap="nowrap" onClick={(e) => { e.stopPropagation(); }}>
      <Tooltip label={actionLabels || 'No actions'} withArrow>
        <ActionIcon
          size="sm"
          variant="subtle"
          color="gray"
          aria-label={label}
          aria-haspopup="true"
          onClick={() => {
            // Stage 1: invoke first non-disabled action on click.
            const first = actions.find((a) => !a.disabled);
            if (first) { first.onClick(); }
          }}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
