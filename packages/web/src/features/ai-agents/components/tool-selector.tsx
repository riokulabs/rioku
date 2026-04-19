/**
 * <ToolSelector> — Mantine MultiSelect wrapper for picking agent tools.
 *
 * Pulls all tools for the tenant from the mock store and lets the caller
 * bind the list of selected IDs.
 */
import { useMemo } from 'react';
import { MultiSelect } from '@mantine/core';
import { useMockStore } from '@/api/mock-store';

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
  const tools = useMockStore((s) => s.aiTools);
  const options = useMemo(() => {
    return Object.values(tools)
      .filter((t) => t.tenant_id === tenantId)
      .map((t) => ({
        value: t.id,
        label: `${t.name} · ${t.kind}`,
      }));
  }, [tools, tenantId]);

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
