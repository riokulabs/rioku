/**
 * <MiddlewareFilterBar> — search + kind + enabled filter for middlewares list.
 */
import { useEffect, useState } from 'react';
import { Group, TextInput, Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { MIDDLEWARE_KINDS } from '../schemas';
import type { MiddlewareFilter } from '../types';

const ENABLED_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

interface MiddlewareFilterBarProps {
  filter: MiddlewareFilter;
  onChange: (next: MiddlewareFilter) => void;
}

export function MiddlewareFilterBar({ filter, onChange }: MiddlewareFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  const kindOptions = [
    { value: 'all', label: 'All kinds' },
    ...MIDDLEWARE_KINDS.map((k) => ({ value: k, label: k })),
  ];

  return (
    <Group gap="sm" align="flex-end">
      <TextInput
        placeholder="Search name or description…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1 }}
        aria-label="Search middlewares"
      />
      <Select
        data={kindOptions}
        value={filter.kind}
        onChange={(value) => {
          onChange({
            ...filter,
            kind: (value ?? 'all') as MiddlewareFilter['kind'],
          });
        }}
        w={160}
        aria-label="Filter by kind"
      />
      <Select
        data={ENABLED_OPTIONS}
        value={filter.enabled}
        onChange={(value) => {
          onChange({
            ...filter,
            enabled: (value ?? 'all') as MiddlewareFilter['enabled'],
          });
        }}
        w={140}
        aria-label="Filter by enabled state"
      />
    </Group>
  );
}
