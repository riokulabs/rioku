/**
 * <ChannelFilterBar> — search + kind + enabled filter for the channels list.
 */
import { useEffect, useState } from 'react';
import { Group, MultiSelect, Select, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { CHANNEL_KINDS } from '../schemas';
import type { ChannelFilter, NotificationChannel } from '../types';

const ENABLED_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

interface ChannelFilterBarProps {
  filter: ChannelFilter;
  onChange: (next: ChannelFilter) => void;
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

const KIND_SET: ReadonlySet<NotificationChannel['kind']> = new Set(CHANNEL_KINDS);

function narrowKinds(values: string[]): NotificationChannel['kind'][] {
  return values.filter((v): v is NotificationChannel['kind'] =>
    KIND_SET.has(v as NotificationChannel['kind']),
  );
}

export function ChannelFilterBar({ filter, onChange }: ChannelFilterBarProps) {
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
        placeholder="Search by name…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1, minWidth: 220 }}
        aria-label="Search notification channels"
      />
      <MultiSelect
        label="Kinds"
        data={CHANNEL_KINDS.map((k) => ({ value: k, label: k }))}
        value={filter.kinds}
        onChange={(values) => {
          onChange({ ...filter, kinds: narrowKinds(values) });
        }}
        placeholder={filter.kinds.length === 0 ? 'All kinds' : undefined}
        clearable
        w={220}
        aria-label="Filter by kind"
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
