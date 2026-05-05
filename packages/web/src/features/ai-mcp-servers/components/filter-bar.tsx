/**
 * <McpServerFilterBar> — search + health + auth-kind + enabled filters.
 */
import { useEffect, useState } from 'react';
import { Group, TextInput, MultiSelect, SegmentedControl } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { McpServer } from '@/api/resources';
import type { McpServerFilter } from '../types';

type Health = McpServer['health'];
type AuthKind = McpServer['auth_kind'];

const HEALTH_OPTIONS: { value: Health; label: string }[] = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'unreachable', label: 'Unreachable' },
  { value: 'disabled', label: 'Disabled' },
];

const AUTH_OPTIONS: { value: AuthKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer' },
  { value: 'api-key', label: 'API key' },
];

const HEALTH_SET = new Set<Health>(['healthy', 'degraded', 'unreachable', 'disabled']);
const AUTH_SET = new Set<AuthKind>(['none', 'bearer', 'api-key']);

interface McpServerFilterBarProps {
  filter: McpServerFilter;
  onChange: (next: McpServerFilter) => void;
}

export function McpServerFilterBar({ filter, onChange }: McpServerFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  const enabledValue = filter.enabled === undefined ? 'all' : filter.enabled ? 'on' : 'off';

  return (
    <Group gap="sm" align="flex-end">
      <TextInput
        placeholder="Search name, url, or description…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1 }}
        aria-label="Search MCP servers"
      />
      <MultiSelect
        data={HEALTH_OPTIONS}
        value={filter.healths}
        onChange={(value) => {
          onChange({
            ...filter,
            healths: value.filter((v): v is Health => (HEALTH_SET as Set<string>).has(v)),
          });
        }}
        placeholder={filter.healths.length === 0 ? 'All healths' : undefined}
        w={200}
        clearable
        aria-label="Filter by health"
      />
      <MultiSelect
        data={AUTH_OPTIONS}
        value={filter.auth_kinds}
        onChange={(value) => {
          onChange({
            ...filter,
            auth_kinds: value.filter((v): v is AuthKind => (AUTH_SET as Set<string>).has(v)),
          });
        }}
        placeholder={filter.auth_kinds.length === 0 ? 'All auth' : undefined}
        w={180}
        clearable
        aria-label="Filter by auth kind"
      />
      <SegmentedControl
        data={[
          { value: 'all', label: 'All' },
          { value: 'on', label: 'Enabled' },
          { value: 'off', label: 'Disabled' },
        ]}
        value={enabledValue}
        onChange={(value) => {
          const next: McpServerFilter = { ...filter };
          if (value === 'all') delete next.enabled;
          else next.enabled = value === 'on';
          onChange(next);
        }}
        aria-label="Filter by enabled"
      />
    </Group>
  );
}
