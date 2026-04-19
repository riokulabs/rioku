/**
 * <ServiceFilterBar> — search + env + health + tag filters for ServiceList.
 *
 * Filter state is owned by the parent route; the filter bar is a pure
 * controlled component. Search input is debounced locally; committed value
 * flows to parent via onChange.
 */
import { useEffect, useState } from 'react';
import { Group, TextInput, Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { ServiceFilter } from '../types';

const HEALTH_OPTIONS = [
  { value: 'all', label: 'All health' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'unhealthy', label: 'Unhealthy' },
  { value: 'disabled', label: 'Disabled' },
];

interface ServiceFilterBarProps {
  filter: ServiceFilter;
  onChange: (next: ServiceFilter) => void;
  /** Distinct env values seen across current tenant's services. */
  envOptions: string[];
  /** Distinct tag values seen across current tenant's services. */
  tagOptions: string[];
}

export function ServiceFilterBar({
  filter,
  onChange,
  envOptions,
  tagOptions,
}: ServiceFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  // Commit debounced search back up to the parent.
  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  const envSelectData = [
    { value: 'all', label: 'All environments' },
    ...envOptions.map((env) => ({ value: env, label: env })),
  ];

  const tagSelectData = [
    { value: '__all__', label: 'All tags' },
    ...tagOptions.map((tag) => ({ value: tag, label: tag })),
  ];

  return (
    <Group gap="sm" align="flex-end">
      <TextInput
        placeholder="Search name, description, or upstream…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1 }}
        aria-label="Search services"
      />
      <Select
        data={envSelectData}
        value={filter.env}
        onChange={(value) => {
          onChange({ ...filter, env: value ?? 'all' });
        }}
        w={180}
        aria-label="Filter by environment"
      />
      <Select
        data={HEALTH_OPTIONS}
        value={filter.health}
        onChange={(value) => {
          onChange({
            ...filter,
            health: (value ?? 'all') as ServiceFilter['health'],
          });
        }}
        w={160}
        aria-label="Filter by health"
      />
      <Select
        data={tagSelectData}
        value={filter.tag ?? '__all__'}
        onChange={(value) => {
          onChange({
            ...filter,
            tag: value === '__all__' || value === null ? null : value,
          });
        }}
        w={160}
        aria-label="Filter by tag"
      />
    </Group>
  );
}
