/**
 * <RateLimitFilterBar> — search + scope + action + enabled filters.
 */
import { useEffect, useState } from 'react';
import {
  Group,
  TextInput,
  MultiSelect,
  SegmentedControl,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { AiSemanticRateLimit } from '@/api/resources/types';
import type { RateLimitFilter } from '../types';

type Scope = AiSemanticRateLimit['scope'];
type Action = AiSemanticRateLimit['action'];

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'tenant', label: 'Tenant' },
  { value: 'agent', label: 'Agent' },
  { value: 'tool', label: 'Tool' },
];

const ACTION_OPTIONS: { value: Action; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'degrade', label: 'Degrade' },
  { value: 'log', label: 'Log' },
];

const SCOPE_SET = new Set<Scope>(['tenant', 'agent', 'tool']);
const ACTION_SET = new Set<Action>(['block', 'degrade', 'log']);

interface RateLimitFilterBarProps {
  filter: RateLimitFilter;
  onChange: (next: RateLimitFilter) => void;
}

export function RateLimitFilterBar({
  filter,
  onChange,
}: RateLimitFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  const enabledValue =
    filter.enabled === undefined ? 'all' : filter.enabled ? 'on' : 'off';

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
        aria-label="Search rate limits"
      />
      <MultiSelect
        data={SCOPE_OPTIONS}
        value={filter.scopes}
        onChange={(value) => {
          onChange({
            ...filter,
            scopes: value.filter((v): v is Scope =>
              (SCOPE_SET as Set<string>).has(v),
            ),
          });
        }}
        placeholder={filter.scopes.length === 0 ? 'All scopes' : undefined}
        w={180}
        clearable
        aria-label="Filter by scope"
      />
      <MultiSelect
        data={ACTION_OPTIONS}
        value={filter.actions}
        onChange={(value) => {
          onChange({
            ...filter,
            actions: value.filter((v): v is Action =>
              (ACTION_SET as Set<string>).has(v),
            ),
          });
        }}
        placeholder={filter.actions.length === 0 ? 'All actions' : undefined}
        w={180}
        clearable
        aria-label="Filter by action"
      />
      <SegmentedControl
        data={[
          { value: 'all', label: 'All' },
          { value: 'on', label: 'Enabled' },
          { value: 'off', label: 'Disabled' },
        ]}
        value={enabledValue}
        onChange={(value) => {
          const next: RateLimitFilter = { ...filter };
          if (value === 'all') delete next.enabled;
          else next.enabled = value === 'on';
          onChange(next);
        }}
        aria-label="Filter by enabled"
      />
    </Group>
  );
}
