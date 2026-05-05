/**
 * <ServiceFilterBar> — search + env + health + tags filters for ServiceList.
 *
 * Filter state is owned by the parent route; the filter bar is a pure
 * controlled component. Search input is debounced locally; committed value
 * flows to parent via onChange.
 *
 * Per Plan 2 Task 2b.9 Step 2: env / health / tags are `MultiSelect` widgets.
 * An empty selection means "no filter" (match all).
 */
import { useEffect, useState } from 'react';
import { Group, TextInput, MultiSelect } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { Service } from '@/api/resources';
import type { ServiceFilter } from '../types';

type HealthStatus = Service['health'];

const HEALTH_OPTIONS: { value: HealthStatus; label: string }[] = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'unhealthy', label: 'Unhealthy' },
  { value: 'disabled', label: 'Disabled' },
];

const HEALTH_VALUES = new Set<HealthStatus>(['healthy', 'degraded', 'unhealthy', 'disabled']);

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
      <MultiSelect
        data={envOptions}
        value={filter.env}
        onChange={(value) => {
          onChange({ ...filter, env: value });
        }}
        placeholder={filter.env.length === 0 ? 'All environments' : undefined}
        w={220}
        clearable
        aria-label="Filter by environment"
      />
      <MultiSelect
        data={HEALTH_OPTIONS}
        value={filter.health}
        onChange={(value) => {
          onChange({
            ...filter,
            health: value.filter((v): v is HealthStatus => (HEALTH_VALUES as Set<string>).has(v)),
          });
        }}
        placeholder={filter.health.length === 0 ? 'All health' : undefined}
        w={200}
        clearable
        aria-label="Filter by health"
      />
      <MultiSelect
        data={tagOptions}
        value={filter.tags}
        onChange={(value) => {
          onChange({ ...filter, tags: value });
        }}
        placeholder={filter.tags.length === 0 ? 'All tags' : undefined}
        w={200}
        clearable
        aria-label="Filter by tag"
      />
    </Group>
  );
}
