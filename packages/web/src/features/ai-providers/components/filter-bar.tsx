/**
 * <ProviderFilterBar> — search + kind + enabled filters for ProviderList.
 */
import { useEffect, useState } from 'react';
import { Group, TextInput, MultiSelect, SegmentedControl } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { AiProvider } from '@/api/resources/types';
import type { ProviderFilter } from '../types';

type Kind = AiProvider['kind'];

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: 'Custom' },
];

const KIND_SET = new Set<Kind>(['openai', 'anthropic', 'gemini', 'ollama', 'custom']);

interface ProviderFilterBarProps {
  filter: ProviderFilter;
  onChange: (next: ProviderFilter) => void;
}

export function ProviderFilterBar({ filter, onChange }: ProviderFilterBarProps) {
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
        placeholder="Search name, base URL, or description…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1 }}
        aria-label="Search providers"
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
        aria-label="Filter by provider kind"
      />
      <SegmentedControl
        data={[
          { value: 'all', label: 'All' },
          { value: 'on', label: 'Enabled' },
          { value: 'off', label: 'Disabled' },
        ]}
        value={enabledValue}
        onChange={(value) => {
          const next: ProviderFilter = { ...filter };
          if (value === 'all') delete next.enabled;
          else next.enabled = value === 'on';
          onChange(next);
        }}
        aria-label="Filter by enabled"
      />
    </Group>
  );
}
