/**
 * <RoutingRuleFilterBar> — search + enabled filter for the routing rules list.
 */
import { useEffect, useState } from 'react';
import { Group, Select, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { RoutingRuleFilter } from '../types';

const ENABLED_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

interface RoutingRuleFilterBarProps {
  filter: RoutingRuleFilter;
  onChange: (next: RoutingRuleFilter) => void;
}

function toTriState(enabled: boolean | undefined): 'all' | 'enabled' | 'disabled' {
  if (enabled === true) return 'enabled';
  if (enabled === false) return 'disabled';
  return 'all';
}

function fromTriState(v: string): boolean | undefined {
  if (v === 'enabled') return true;
  if (v === 'disabled') return false;
  return undefined;
}

export function RoutingRuleFilterBar({
  filter,
  onChange,
}: RoutingRuleFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  return (
    <Group gap="sm" align="flex-end" wrap="wrap">
      <TextInput
        placeholder="Search by name or event filter…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1, minWidth: 240 }}
        aria-label="Search routing rules"
      />
      <Select
        label="Enabled"
        data={ENABLED_OPTIONS}
        value={toTriState(filter.enabled)}
        allowDeselect={false}
        onChange={(v) => {
          onChange({ ...filter, enabled: fromTriState(v ?? 'all') });
        }}
        w={140}
        aria-label="Filter by enabled state"
      />
    </Group>
  );
}
