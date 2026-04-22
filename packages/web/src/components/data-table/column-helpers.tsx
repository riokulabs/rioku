/**
 * column-helpers.tsx — Common cell renderers for <DataTable> column definitions.
 *
 * Keeps feature pages from duplicating timestamp formatting, status badges, and
 * action menus. Import these as building blocks when defining ColumnDef arrays.
 */

import type { ReactNode } from 'react';
import { Badge, Group, ActionIcon, Menu, Text, Tooltip } from '@mantine/core';
import { IconDots } from '@tabler/icons-react';
import type { Row } from '@tanstack/react-table';
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
      <Text size="sm" c="var(--mantine-color-gray-7)">
        —
      </Text>
    );
  }

  const d = dayjs(value);
  if (!d.isValid()) {
    return (
      <Text size="sm" c="var(--mantine-color-gray-7)">
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

export interface ActionItem<T = unknown> {
  /** Unique key for React reconciliation. Falls back to `label` if omitted. */
  key?: string;
  label: string;
  /** Optional icon placed to the left of the label inside the menu item. */
  icon?: ReactNode;
  /** Called with the row's original data when the menu item is clicked. */
  onClick: (row: T) => void;
  /** When true the item is rendered with `color="red"`. */
  destructive?: boolean;
  /** Per-row disabled predicate. */
  disabled?: (row: T) => boolean;
  /** When returns true the item is omitted from the menu entirely. */
  hidden?: (row: T) => boolean;
  /** Mantine color override (takes precedence over `destructive`). */
  color?: string;
}

export interface ActionsCellProps<T = unknown> {
  row: Row<T>;
  actions: ActionItem<T>[];
  /** Accessible label for the trigger button. */
  label?: string;
}

/**
 * ActionsCell renders an overflow `...` button that opens a Mantine <Menu>
 * dropdown containing per-row action items.
 */
export function ActionsCell<T>({ row, actions, label = 'Row actions' }: ActionsCellProps<T>) {
  const available = actions.filter((a) => !a.hidden?.(row.original));
  if (available.length === 0) return null;

  return (
    <Group
      gap={4}
      wrap="nowrap"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <Menu shadow="md" position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={label}
            data-testid="row-actions"
          >
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {available.map((action) => {
            const itemColor = action.color ?? (action.destructive ? 'red' : undefined);
            const isDisabled = action.disabled?.(row.original) ?? false;
            return (
              <Menu.Item
                key={action.key ?? action.label}
                leftSection={action.icon}
                onClick={() => {
                  action.onClick(row.original);
                }}
                disabled={isDisabled}
                {...(itemColor !== undefined ? { color: itemColor } : {})}
                data-testid={`row-action-${action.key ?? action.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {action.label}
              </Menu.Item>
            );
          })}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
