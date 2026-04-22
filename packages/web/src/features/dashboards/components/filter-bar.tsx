/**
 * <DashboardFilterBar> — search + owner + mode + scope + default-only filters.
 */
import { useEffect, useMemo, useState } from 'react';
import { Group, TextInput, MultiSelect, Switch } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import type { Dashboard, DashboardFilter } from '../types';

type Mode = Dashboard['mode'];
type Scope = Dashboard['scope'];

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'metabase', label: 'Metabase' },
  { value: 'grafana', label: 'Grafana' },
];

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'shared', label: 'Shared' },
];

const MODE_SET = new Set<Mode>(['metabase', 'grafana']);
const SCOPE_SET = new Set<Scope>(['personal', 'tenant', 'shared']);

interface DashboardFilterBarProps {
  tenantId: string;
  filter: DashboardFilter;
  onChange: (next: DashboardFilter) => void;
  /** Optional: selected owner user IDs. Empty = no owner filter. */
  owners: string[];
  onOwnersChange: (owners: string[]) => void;
}

export function DashboardFilterBar({
  tenantId,
  filter,
  onChange,
  owners,
  onOwnersChange,
}: DashboardFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  const users = useMockStore((s) => s.users);
  const memberships = useMockStore((s) => s.memberships);

  const ownerOptions = useMemo(() => {
    const tenantUserIds = new Set<string>();
    for (const m of Object.values(memberships)) {
      if (m.tenant_id === tenantId && m.state === 'active') {
        tenantUserIds.add(m.user_id);
      }
    }
    const opts: { value: string; label: string }[] = [
      { value: '__shared__', label: 'Tenant-shared' },
    ];
    for (const uid of tenantUserIds) {
      const u = users[uid];
      opts.push({ value: uid, label: u?.name ?? uid });
    }
    return opts;
  }, [memberships, users, tenantId]);

  return (
    <Group gap="sm" align="flex-end" wrap="wrap">
      <TextInput
        placeholder="Search name or description…"
        leftSection={<IconSearch size={14} />}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.currentTarget.value);
        }}
        style={{ flex: 1, minWidth: 220 }}
        aria-label="Search dashboards"
      />
      <MultiSelect
        data={ownerOptions}
        value={owners}
        onChange={onOwnersChange}
        placeholder={owners.length === 0 ? 'All owners' : undefined}
        w={220}
        clearable
        aria-label="Filter by owner"
      />
      <MultiSelect
        data={MODE_OPTIONS}
        value={filter.modes}
        onChange={(value) => {
          onChange({
            ...filter,
            modes: value.filter((v): v is Mode => (MODE_SET as Set<string>).has(v)),
          });
        }}
        placeholder={filter.modes.length === 0 ? 'All modes' : undefined}
        w={180}
        clearable
        aria-label="Filter by mode"
      />
      <MultiSelect
        data={SCOPE_OPTIONS}
        value={filter.scopes}
        onChange={(value) => {
          onChange({
            ...filter,
            scopes: value.filter((v): v is Scope => (SCOPE_SET as Set<string>).has(v)),
          });
        }}
        placeholder={filter.scopes.length === 0 ? 'All scopes' : undefined}
        w={180}
        clearable
        aria-label="Filter by scope"
      />
      <Switch
        label="Default only"
        checked={filter.defaultOnly === true}
        onChange={(e) => {
          const next: DashboardFilter = { ...filter };
          if (e.currentTarget.checked) next.defaultOnly = true;
          else delete next.defaultOnly;
          onChange(next);
        }}
        aria-label="Show only the tenant default dashboard"
      />
    </Group>
  );
}
