/**
 * <ToolFilterBar> — search + kind + dangerous + enabled filters for ToolList.
 */
import { useEffect, useState } from 'react';
import { Group, TextInput, MultiSelect, SegmentedControl } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { AiTool } from '@/api/resources';
import type { ToolFilter } from '../types';

type Kind = AiTool['kind'];

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'native', label: 'Native' },
  { value: 'mcp', label: 'MCP' },
  { value: 'http', label: 'HTTP' },
];

const KIND_SET = new Set<Kind>(['native', 'mcp', 'http']);

interface ToolFilterBarProps {
  filter: ToolFilter;
  onChange: (next: ToolFilter) => void;
}

export function ToolFilterBar({ filter, onChange }: ToolFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  const enabledValue = filter.enabled === undefined ? 'all' : filter.enabled ? 'on' : 'off';
  const dangerousValue = filter.dangerous === undefined ? 'all' : filter.dangerous ? 'yes' : 'no';

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
        aria-label="Search tools"
      />
      <MultiSelect
        data={KIND_OPTIONS}
        value={filter.kinds}
        onChange={(value) => {
          onChange({
            ...filter,
            kinds: value.filter((v): v is Kind => (KIND_SET as Set<string>).has(v)),
          });
        }}
        placeholder={filter.kinds.length === 0 ? 'All kinds' : undefined}
        w={220}
        clearable
        aria-label="Filter by tool kind"
      />
      <SegmentedControl
        data={[
          { value: 'all', label: 'All' },
          { value: 'yes', label: 'Dangerous' },
          { value: 'no', label: 'Safe' },
        ]}
        value={dangerousValue}
        onChange={(value) => {
          const next: ToolFilter = { ...filter };
          if (value === 'all') delete next.dangerous;
          else next.dangerous = value === 'yes';
          onChange(next);
        }}
        aria-label="Filter by dangerous"
      />
      <SegmentedControl
        data={[
          { value: 'all', label: 'All' },
          { value: 'on', label: 'Enabled' },
          { value: 'off', label: 'Disabled' },
        ]}
        value={enabledValue}
        onChange={(value) => {
          const next: ToolFilter = { ...filter };
          if (value === 'all') delete next.enabled;
          else next.enabled = value === 'on';
          onChange(next);
        }}
        aria-label="Filter by enabled"
      />
    </Group>
  );
}
