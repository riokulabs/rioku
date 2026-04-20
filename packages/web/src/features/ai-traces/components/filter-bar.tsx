/**
 * <TraceFilterBar> — search + agent + status + date-range filters.
 *
 * Text search over prompt/completion is gated on `ai-trace:read-sensitive`.
 * When the user lacks that permission the TextInput is disabled and a Tooltip
 * explains the gate.
 *
 * Date range is modeled as a SegmentedControl with presets (1h/24h/7d/all) +
 * a custom DatePickerInput pair. We opt for DatePickerInput over DateTimePicker
 * to keep the API surface small — the filter is inclusive-lower, exclusive-upper
 * on ISO strings at the api layer.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Group,
  TextInput,
  MultiSelect,
  SegmentedControl,
  Tooltip,
  Stack,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { usePermission } from '@/hooks/use-permission';
import type { AiTrace } from '@/api/resources/types';
import type { TraceFilter } from '../types';

export type RangePreset = '1h' | '24h' | '7d' | 'all' | 'custom';

const STATUS_OPTIONS: { value: AiTrace['status']; label: string }[] = [
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
  { value: 'timeout', label: 'Timeout' },
];

interface TraceFilterBarProps {
  tenantId: string;
  filter: TraceFilter;
  rangePreset: RangePreset;
  onChange: (next: TraceFilter, nextPreset: RangePreset) => void;
}

function presetToSince(preset: RangePreset): string | undefined {
  const now = Date.now();
  switch (preset) {
    case '1h':
      return new Date(now - 60 * 60 * 1000).toISOString();
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    default:
      return undefined;
  }
}

export function TraceFilterBar({
  tenantId,
  filter,
  rangePreset,
  onChange,
}: TraceFilterBarProps) {
  const canReadSensitive = usePermission('ai-trace:read-sensitive');
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  const agents = useMockStore((s) => s.aiAgents);
  const agentOptions = useMemo(() => {
    return Object.values(agents)
      .filter((a) => a.tenant_id === tenantId)
      .map((a) => ({ value: a.id, label: a.name }));
  }, [agents, tenantId]);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch }, rangePreset);
    }
  }, [debouncedSearch, filter, rangePreset, onChange]);

  const customRange = useMemo<[Date | null, Date | null]>(() => {
    if (rangePreset !== 'custom') return [null, null];
    return [
      filter.since ? new Date(filter.since) : null,
      filter.until ? new Date(filter.until) : null,
    ];
  }, [filter.since, filter.until, rangePreset]);

  function handlePreset(next: RangePreset) {
    if (next === 'custom') {
      // Keep existing since/until if already set, otherwise clear.
      onChange(filter, 'custom');
      return;
    }
    const since = presetToSince(next);
    const nextFilter: TraceFilter = { ...filter };
    if (since) nextFilter.since = since;
    else delete nextFilter.since;
    delete nextFilter.until;
    onChange(nextFilter, next);
  }

  function handleCustomRange(range: [Date | null, Date | null]) {
    const next: TraceFilter = { ...filter };
    if (range[0]) next.since = range[0].toISOString();
    else delete next.since;
    if (range[1]) next.until = range[1].toISOString();
    else delete next.until;
    onChange(next, 'custom');
  }

  const searchField = (
    <TextInput
      placeholder={
        canReadSensitive
          ? 'Search prompt or completion…'
          : 'Sensitive search disabled'
      }
      leftSection={<IconSearch size={14} />}
      value={canReadSensitive ? searchInput : ''}
      onChange={(e) => {
        setSearchInput(e.currentTarget.value);
      }}
      disabled={!canReadSensitive}
      style={{ flex: 1, minWidth: 240 }}
      aria-label="Search trace text"
    />
  );

  return (
    <Stack gap="xs">
      <Group gap="sm" align="flex-end" wrap="wrap">
        {canReadSensitive ? (
          searchField
        ) : (
          <Tooltip
            label="You need ai-trace:read-sensitive to search prompt and completion text."
            withArrow
          >
            <div style={{ flex: 1, minWidth: 240 }}>{searchField}</div>
          </Tooltip>
        )}
        <MultiSelect
          data={agentOptions}
          value={filter.agent_ids}
          onChange={(value) => {
            onChange({ ...filter, agent_ids: value }, rangePreset);
          }}
          placeholder={filter.agent_ids.length === 0 ? 'All agents' : undefined}
          w={220}
          clearable
          searchable
          aria-label="Filter by agent"
        />
        <MultiSelect
          data={STATUS_OPTIONS}
          value={filter.statuses}
          onChange={(value) => {
            onChange(
              {
                ...filter,
                statuses: value as AiTrace['status'][],
              },
              rangePreset,
            );
          }}
          placeholder={filter.statuses.length === 0 ? 'All statuses' : undefined}
          w={200}
          clearable
          aria-label="Filter by status"
        />
        <SegmentedControl
          data={[
            { value: '1h', label: '1h' },
            { value: '24h', label: '24h' },
            { value: '7d', label: '7d' },
            { value: 'all', label: 'All' },
            { value: 'custom', label: 'Custom' },
          ]}
          value={rangePreset}
          onChange={(value) => {
            handlePreset(value as RangePreset);
          }}
          aria-label="Time range"
        />
      </Group>
      {rangePreset === 'custom' && (
        <Group gap="sm" align="flex-end">
          <DatePickerInput
            type="range"
            label="Custom range"
            placeholder="Pick dates"
            value={customRange}
            onChange={(val) => {
              const cast = val as [Date | null, Date | null];
              handleCustomRange(cast);
            }}
            clearable
            w={320}
            aria-label="Custom date range"
          />
        </Group>
      )}
    </Stack>
  );
}
