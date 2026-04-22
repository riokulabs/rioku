/**
 * <PermissionSelector> — multi-select over the full permission catalog.
 *
 * Renders a Mantine <MultiSelect> that:
 *   - Sources options from the permission catalog via usePermissionsCatalog()
 *   - Groups permissions by namespace (built-ins first, then plugin namespaces)
 *   - Shows a "dynamic" badge next to plugin-dynamic permissions
 *   - Supports full-text search (Mantine MultiSelect searchable prop)
 *   - Renders selected values as removable pills
 *   - Excludes permissions listed in the excludePermissions prop
 *
 * spec §7.1 / Task 1d.66
 */

import { useMemo } from 'react';
import { MultiSelect, Badge, Group, Text, type ComboboxItem } from '@mantine/core';
import { usePermissionsCatalog } from '../../hooks/use-permissions-catalog';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PermissionSelectorProps {
  value: string[];
  onChange: (v: string[]) => void;
  label?: string;
  excludePermissions?: string[];
}

// ─── Extended ComboboxItem type for our use ───────────────────────────────────

interface PermissionItem extends ComboboxItem {
  isDynamic: boolean;
}

// ─── Render option ────────────────────────────────────────────────────────────

function renderOption({ option }: { option: ComboboxItem }) {
  const item = option as PermissionItem;
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" style={{ flex: 1 }}>
        {item.value}
      </Text>
      {item.isDynamic && (
        <Badge size="xs" variant="light" color="violet">
          dynamic
        </Badge>
      )}
    </Group>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PermissionSelector({
  value,
  onChange,
  label,
  excludePermissions = [],
}: PermissionSelectorProps) {
  const { groups } = usePermissionsCatalog();

  const excludeSet = useMemo(() => new Set(excludePermissions), [excludePermissions]);

  // Build Mantine MultiSelect data with groups
  const data = useMemo(() => {
    return groups
      .map((group) => {
        const filteredItems: PermissionItem[] = group.permissions
          .filter((p) => !excludeSet.has(p.key))
          .map((p) => ({
            value: p.key,
            label: p.key,
            isDynamic: p.source === 'plugin-dynamic',
          }));

        if (filteredItems.length === 0) return null;

        return {
          group: group.label,
          items: filteredItems,
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [groups, excludeSet]);

  return (
    <MultiSelect
      label={label}
      data={data}
      value={value}
      onChange={onChange}
      searchable
      clearable
      renderOption={renderOption}
      placeholder={value.length === 0 ? 'Search permissions…' : undefined}
      maxDropdownHeight={300}
    />
  );
}
