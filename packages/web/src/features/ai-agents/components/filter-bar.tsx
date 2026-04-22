/**
 * <AgentFilterBar> — search + provider + enabled filters for AgentList.
 */
import { useEffect, useMemo, useState } from 'react';
import { Group, TextInput, MultiSelect, SegmentedControl } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import type { AgentFilter } from '../types';

interface AgentFilterBarProps {
  tenantId: string;
  filter: AgentFilter;
  onChange: (next: AgentFilter) => void;
}

export function AgentFilterBar({ tenantId, filter, onChange }: AgentFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  const providers = useMockStore((s) => s.aiProviders);
  const providerOptions = useMemo(() => {
    return Object.values(providers)
      .filter((p) => p.tenant_id === tenantId)
      .map((p) => ({ value: p.id, label: p.name }));
  }, [providers, tenantId]);

  const roles = useMockStore((s) => s.roles);
  const roleOptions = useMemo(() => {
    return Object.values(roles)
      .filter((r) => r.tenant_id === tenantId)
      .map((r) => ({ value: r.id, label: r.name }));
  }, [roles, tenantId]);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  const enabledValue = filter.enabled === undefined ? 'all' : filter.enabled ? 'on' : 'off';

  return (
    <Group gap="sm" align="flex-end">
      <TextInput
        placeholder="Search name, description, or model…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1 }}
        aria-label="Search agents"
      />
      <MultiSelect
        data={providerOptions}
        value={filter.provider_ids}
        onChange={(value) => {
          onChange({ ...filter, provider_ids: value });
        }}
        placeholder={filter.provider_ids.length === 0 ? 'All providers' : undefined}
        w={220}
        clearable
        aria-label="Filter by provider"
      />
      <MultiSelect
        data={roleOptions}
        value={filter.role_ids}
        onChange={(value) => {
          onChange({ ...filter, role_ids: value });
        }}
        placeholder={filter.role_ids.length === 0 ? 'All roles' : undefined}
        w={220}
        clearable
        aria-label="Filter by role"
      />
      <SegmentedControl
        data={[
          { value: 'all', label: 'All' },
          { value: 'on', label: 'Enabled' },
          { value: 'off', label: 'Disabled' },
        ]}
        value={enabledValue}
        onChange={(value) => {
          const next: AgentFilter = { ...filter };
          if (value === 'all') delete next.enabled;
          else next.enabled = value === 'on';
          onChange(next);
        }}
        aria-label="Filter by enabled"
      />
    </Group>
  );
}
