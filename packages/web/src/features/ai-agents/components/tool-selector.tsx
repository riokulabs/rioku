/**
 * <ToolSelector> — Mantine MultiSelect wrapper for picking agent tools.
 *
 * Pulls all tools for the tenant via the real ai-tools list endpoint and
 * lets the caller bind the list of selected IDs.
 */
import { useMemo } from 'react';
import { MultiSelect } from '@mantine/core';
import { useToolList } from '@/features/ai-tools/api';
import type { ToolFilter } from '@/features/ai-tools/types';

const EMPTY_TOOL_FILTER: ToolFilter = { search: '', kinds: [] };

interface ToolSelectorProps {
  tenantId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  placeholder?: string;
}

export function ToolSelector({
  tenantId,
  value,
  onChange,
  label = 'Tools',
  placeholder = 'Select tools…',
}: ToolSelectorProps) {
  const tools = useToolList(tenantId, EMPTY_TOOL_FILTER);
  const options = useMemo(
    () => tools.map((t) => ({ value: t.id, label: `${t.name} · ${t.kind}` })),
    [tools],
  );

  return (
    <MultiSelect
      label={label}
      placeholder={placeholder}
      data={options}
      value={value}
      onChange={onChange}
      searchable
      clearable
      aria-label="Tool selector"
    />
  );
}
