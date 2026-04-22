/**
 * <SignerFilterBar> — search + status MultiSelect for the signers table.
 *
 * Mirrors ai-providers/filter-bar.tsx: text input debounced locally, committed
 * back up via onChange. Caller controls URL-sync.
 */
import { useEffect, useState } from 'react';
import { Group, MultiSelect, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { PluginSigner } from '@/api/resources/types';
import type { SignerFilter } from '../types';

type Status = PluginSigner['status'];

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'verified', label: 'Verified' },
  { value: 'pending', label: 'Pending' },
  { value: 'revoked', label: 'Revoked' },
];

const STATUS_SET = new Set<Status>(['verified', 'pending', 'revoked']);

interface SignerFilterBarProps {
  filter: SignerFilter;
  onChange: (next: SignerFilter) => void;
}

export function SignerFilterBar({ filter, onChange }: SignerFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  return (
    <Group gap="sm" align="flex-end">
      <TextInput
        placeholder="Search name or fingerprint…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1 }}
        aria-label="Search signers"
      />
      <MultiSelect
        data={STATUS_OPTIONS}
        value={filter.statuses}
        onChange={(value) => {
          onChange({
            ...filter,
            statuses: value.filter((v): v is Status => (STATUS_SET as Set<string>).has(v)),
          });
        }}
        placeholder={filter.statuses.length === 0 ? 'All statuses' : undefined}
        w={220}
        clearable
        aria-label="Filter by status"
      />
    </Group>
  );
}
