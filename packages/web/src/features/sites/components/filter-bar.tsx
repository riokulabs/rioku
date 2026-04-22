/**
 * <SiteFilterBar> — search + tls_mode + enabled + linked-service filters.
 *
 * Filter state is owned by the parent route; the filter bar is a pure
 * controlled component. Search input is debounced locally; committed value
 * flows to parent via onChange.
 *
 * Per Plan 2 Task 2c.18: tls_mode / enabled / linked_service_ids are all
 * MultiSelect widgets. Empty selection means "no filter".
 */
import { useEffect, useState } from 'react';
import { Group, MultiSelect, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { Site } from '@/api/resources/types';
import type { SiteEnabledFilter, SiteFilter } from '../types';

type TlsMode = Site['tls_mode'];

const TLS_OPTIONS: { value: TlsMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'manual', label: 'Manual' },
  { value: 'off', label: 'Off' },
];

const TLS_VALUES = new Set<TlsMode>(['auto', 'manual', 'off']);

const ENABLED_OPTIONS: { value: SiteEnabledFilter; label: string }[] = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

const ENABLED_VALUES = new Set<SiteEnabledFilter>(['enabled', 'disabled']);

interface SiteFilterBarProps {
  filter: SiteFilter;
  onChange: (next: SiteFilter) => void;
  /** All services in the current tenant — sourced by the parent route. */
  serviceOptions: { value: string; label: string }[];
}

export function SiteFilterBar({ filter, onChange, serviceOptions }: SiteFilterBarProps) {
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
        placeholder="Search domain or name…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1 }}
        aria-label="Search sites"
      />
      <MultiSelect
        data={TLS_OPTIONS}
        value={filter.tls_mode}
        onChange={(value) => {
          onChange({
            ...filter,
            tls_mode: value.filter((v): v is TlsMode => (TLS_VALUES as Set<string>).has(v)),
          });
        }}
        placeholder={filter.tls_mode.length === 0 ? 'All TLS modes' : undefined}
        w={180}
        clearable
        aria-label="Filter by TLS mode"
      />
      <MultiSelect
        data={ENABLED_OPTIONS}
        value={filter.enabled}
        onChange={(value) => {
          onChange({
            ...filter,
            enabled: value.filter((v): v is SiteEnabledFilter =>
              (ENABLED_VALUES as Set<string>).has(v),
            ),
          });
        }}
        placeholder={filter.enabled.length === 0 ? 'All states' : undefined}
        w={160}
        clearable
        aria-label="Filter by enabled state"
      />
      <MultiSelect
        data={serviceOptions}
        value={filter.linked_service_ids}
        onChange={(value) => {
          onChange({ ...filter, linked_service_ids: value });
        }}
        placeholder={filter.linked_service_ids.length === 0 ? 'All linked services' : undefined}
        w={240}
        clearable
        searchable
        aria-label="Filter by linked service"
      />
    </Group>
  );
}
