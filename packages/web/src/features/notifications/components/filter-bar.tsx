/**
 * <NotificationFilterBar> — filters for the full inbox page.
 *
 * Controls (left → right):
 *   - Search (title + body substring; debounced 300ms)
 *   - Category MultiSelect (bounded enum: system / security / audit + any
 *     plugin categories discovered in the current user's notifications)
 *   - Severity MultiSelect
 *   - Read/Unread SegmentedControl (All / Unread / Read)
 *   - Include-archived Switch
 *
 * All filter writes go through the parent `onChange` callback — the parent
 * is responsible for URL-syncing the filter state.
 */
import { useEffect, useMemo, useState } from 'react';
import { Group, MultiSelect, SegmentedControl, Stack, Switch, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { InboxFilter, NotificationItem } from '../types';

const SEVERITY_OPTIONS: { value: NotificationItem['severity']; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
  { value: 'success', label: 'Success' },
];
const SEVERITY_SET: ReadonlySet<NotificationItem['severity']> = new Set([
  'info',
  'warn',
  'error',
  'success',
]);
function narrowSeverities(values: string[]): NotificationItem['severity'][] {
  return values.filter((v): v is NotificationItem['severity'] =>
    SEVERITY_SET.has(v as NotificationItem['severity']),
  );
}

export type ReadFilter = 'all' | 'unread' | 'read';

export interface NotificationFilterBarProps {
  filter: InboxFilter;
  /** Current read/unread segmented state (derived from `unreadOnly`). */
  readFilter: ReadFilter;
  /** All notifications for the user — used to discover plugin categories so
   *  the MultiSelect can offer them as options. */
  allNotifications: NotificationItem[];
  onChange: (next: InboxFilter, readFilter: ReadFilter) => void;
}

export function NotificationFilterBar({
  filter,
  readFilter,
  allNotifications,
  onChange,
}: NotificationFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch }, readFilter);
    }
  }, [debouncedSearch, filter, onChange, readFilter]);

  // Build the category option list dynamically — built-ins up front, then any
  // plugin categories that exist in the current user's inbox.
  const categoryOptions = useMemo(() => {
    const base = [
      { value: 'system', label: 'System' },
      { value: 'security', label: 'Security' },
      { value: 'audit', label: 'Audit' },
    ];
    const plugins = new Set<string>();
    for (const n of allNotifications) {
      if (n.category.startsWith('plugin:')) plugins.add(n.category);
    }
    for (const p of [...plugins].sort()) {
      base.push({ value: p, label: `Plugin · ${p.slice('plugin:'.length)}` });
    }
    return base;
  }, [allNotifications]);

  function handleReadChange(next: string) {
    const narrow: ReadFilter = next === 'unread' || next === 'read' ? next : 'all';
    onChange({ ...filter, unreadOnly: narrow === 'unread' }, narrow);
  }

  return (
    <Stack gap="xs" data-testid="notification-filter-bar">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          placeholder="Search title or body…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.currentTarget.value);
          }}
          style={{ flex: 1, minWidth: 240 }}
          aria-label="Search notifications"
          data-testid="notification-search-input"
        />
        <MultiSelect
          label="Category"
          data={categoryOptions}
          value={filter.categories}
          onChange={(values) => {
            onChange({ ...filter, categories: values }, readFilter);
          }}
          placeholder={filter.categories.length === 0 ? 'All categories' : undefined}
          searchable
          clearable
          w={240}
          aria-label="Filter by category"
        />
        <MultiSelect
          label="Severity"
          data={SEVERITY_OPTIONS}
          value={filter.severities}
          onChange={(values) => {
            onChange({ ...filter, severities: narrowSeverities(values) }, readFilter);
          }}
          placeholder={filter.severities.length === 0 ? 'All severities' : undefined}
          clearable
          w={200}
          aria-label="Filter by severity"
        />
      </Group>
      <Group gap="md" wrap="wrap">
        <SegmentedControl
          value={readFilter}
          onChange={handleReadChange}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Unread', value: 'unread' },
            { label: 'Read', value: 'read' },
          ]}
          aria-label="Filter by read state"
          data-testid="notification-read-filter"
        />
        <Switch
          checked={filter.includeArchived}
          onChange={(e) => {
            onChange({ ...filter, includeArchived: e.currentTarget.checked }, readFilter);
          }}
          label="Include archived"
          size="sm"
          data-testid="notification-include-archived"
        />
      </Group>
    </Stack>
  );
}
