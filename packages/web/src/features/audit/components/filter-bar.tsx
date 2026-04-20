/**
 * <AuditFilterBar> — bounded + async unbounded + date range + free-text.
 *
 * Bounded filters (MultiSelect):
 *   - actions         (enum drawn from the full seeded action catalog)
 *   - outcomes        (success / denied / error)
 *   - resource_types  (enum)
 *   - tiers           (read / read-sensitive / write / destructive)
 *
 * Unbounded filters (<MultiSelectAsync>, §13.2a opaque handles):
 *   - actors          — wraps searchActors
 *   - resource ids    — resource-type Select → searchResourceIds
 *
 * Free-text search is permission-gated on audit:read-sensitive — the input
 * is disabled (wrapped in a Tooltip explaining why) when the caller lacks
 * the permission so programmatic callers can't hide the gate.
 *
 * Advanced filters (actors + resource-id + date range) are collapsed behind
 * a toggle — the bar stays tight for the common case of bounded-only filters.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Collapse,
  Group,
  MultiSelect,
  Select,
  Stack,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconChevronDown,
  IconChevronRight,
  IconSearch,
} from '@tabler/icons-react';
import { MultiSelectAsync, type MultiSelectAsyncPage } from '@/components/multi-select-async';
import { usePermission } from '@/hooks/use-permission';
import { searchActors, searchResourceIds } from '../api';
import type { AuditFilter } from '../types';

// ─── Bounded options ─────────────────────────────────────────────────────────

/** Canonical seeded action catalog — mirrors mock-seed. */
const ACTION_OPTIONS = [
  'user.login', 'user.logout', 'user.invite', 'user.disable',
  'role.create', 'role.update', 'role.delete',
  'service.create', 'service.update', 'service.delete', 'service.health_check',
  'route.create', 'route.update', 'route.delete',
  'api_key.create', 'api_key.revoke',
  'session.create', 'session.revoke',
  'access-policy.create', 'access-policy.update', 'access-policy.delete',
  'rbac-policy.create', 'rbac-policy.update', 'rbac-policy.delete',
  'plugin.install', 'plugin.enable', 'plugin.disable',
  'tenant.update', 'site.create', 'site.update',
  'audit.retention.update',
].map((a) => ({ value: a, label: a }));

const OUTCOME_OPTIONS: { value: AuditFilter['outcomes'][number]; label: string }[] = [
  { value: 'success', label: 'Success' },
  { value: 'denied', label: 'Denied' },
  { value: 'error', label: 'Error' },
];
const OUTCOME_SET: ReadonlySet<AuditFilter['outcomes'][number]> = new Set([
  'success',
  'denied',
  'error',
]);
function narrowOutcomes(values: string[]): AuditFilter['outcomes'] {
  return values.filter((v): v is AuditFilter['outcomes'][number] =>
    OUTCOME_SET.has(v as AuditFilter['outcomes'][number]),
  );
}

const RESOURCE_TYPE_OPTIONS = [
  'user', 'role', 'service', 'route', 'api_key', 'session',
  'access-policy', 'rbac-policy', 'plugin', 'tenant', 'site',
  'audit-retention',
].map((r) => ({ value: r, label: r }));

const TIER_OPTIONS: { value: AuditFilter['tiers'][number]; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'read-sensitive', label: 'Read-sensitive' },
  { value: 'write', label: 'Write' },
  { value: 'destructive', label: 'Destructive' },
];
const TIER_SET: ReadonlySet<AuditFilter['tiers'][number]> = new Set([
  'read',
  'read-sensitive',
  'write',
  'destructive',
]);
function narrowTiers(values: string[]): AuditFilter['tiers'] {
  return values.filter((v): v is AuditFilter['tiers'][number] =>
    TIER_SET.has(v as AuditFilter['tiers'][number]),
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AuditFilterBarProps {
  tenantId: string;
  filter: AuditFilter;
  onChange: (next: AuditFilter) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AuditFilterBar({
  tenantId,
  filter,
  onChange,
}: AuditFilterBarProps) {
  const canReadSensitive = usePermission('audit:read-sensitive');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

  // Resource-id search requires a concrete resource_type to scope the lookup.
  const [resourceTypeForSearch, setResourceTypeForSearch] = useState<string>('service');

  const actorSearchFn = useCallback(
    async (q: string, cursor?: string): Promise<MultiSelectAsyncPage> => {
      const page = await searchActors(tenantId, q, cursor);
      return cursor !== undefined || page.nextCursor !== undefined
        ? {
            items: page.items.map((c) => ({
              handle: c.handle,
              label: c.label,
            })),
            ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
          }
        : { items: page.items };
    },
    [tenantId],
  );

  const resourceIdSearchFn = useCallback(
    async (q: string, cursor?: string): Promise<MultiSelectAsyncPage> => {
      const page = await searchResourceIds(tenantId, resourceTypeForSearch, q, cursor);
      return {
        items: page.items.map((c) => ({
          handle: c.handle,
          label: `${c.resource_type}:${c.label}`,
        })),
        ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
      };
    },
    [tenantId, resourceTypeForSearch],
  );

  const dateRangeValue = useMemo<[Date | null, Date | null]>(
    () => [
      filter.date_from ? new Date(filter.date_from) : null,
      filter.date_to ? new Date(filter.date_to) : null,
    ],
    [filter.date_from, filter.date_to],
  );

  const handleDateRange = useCallback(
    (range: [Date | null, Date | null]) => {
      const [from, to] = range;
      const next: AuditFilter = {
        ...filter,
        date_from: from ? from.toISOString() : null,
        date_to: null,
      };
      if (to) {
        const endDate = new Date(to);
        // DatePickerInput yields midnight — push to end-of-day so the upper
        // bound is inclusive of the selected calendar day. Filter matcher
        // treats `date_to` as exclusive (`entry.at >= date_to` rejects).
        endDate.setHours(23, 59, 59, 999);
        next.date_to = endDate.toISOString();
      }
      onChange(next);
    },
    [filter, onChange],
  );

  const searchInputEl = (
    <TextInput
      placeholder={
        canReadSensitive
          ? 'Search action, resource, payload…'
          : 'Sensitive search disabled'
      }
      leftSection={<IconSearch size={14} />}
      value={canReadSensitive ? searchInput : ''}
      onChange={(e) => {
        setSearchInput(e.currentTarget.value);
      }}
      disabled={!canReadSensitive}
      style={{ flex: 1, minWidth: 240 }}
      aria-label="Search audit entries"
      data-testid="audit-search-input"
    />
  );

  return (
    <Stack gap="xs" data-testid="audit-filter-bar">
      {/* Primary row — bounded filters + search */}
      <Group gap="sm" align="flex-end" wrap="wrap">
        {canReadSensitive ? (
          searchInputEl
        ) : (
          <Tooltip
            label="You need audit:read-sensitive to search entry payloads."
            withArrow
          >
            <div style={{ flex: 1, minWidth: 240 }}>{searchInputEl}</div>
          </Tooltip>
        )}
        <MultiSelect
          label="Actions"
          data={ACTION_OPTIONS}
          value={filter.actions}
          onChange={(values) => {
            onChange({ ...filter, actions: values });
          }}
          placeholder={filter.actions.length === 0 ? 'All actions' : undefined}
          searchable
          clearable
          w={220}
          aria-label="Filter by action"
        />
        <MultiSelect
          label="Outcome"
          data={OUTCOME_OPTIONS}
          value={filter.outcomes}
          onChange={(values) => {
            onChange({ ...filter, outcomes: narrowOutcomes(values) });
          }}
          placeholder={filter.outcomes.length === 0 ? 'All outcomes' : undefined}
          clearable
          w={180}
          aria-label="Filter by outcome"
        />
        <MultiSelect
          label="Resource type"
          data={RESOURCE_TYPE_OPTIONS}
          value={filter.resource_types}
          onChange={(values) => {
            onChange({ ...filter, resource_types: values });
          }}
          placeholder={filter.resource_types.length === 0 ? 'All types' : undefined}
          clearable
          w={200}
          aria-label="Filter by resource type"
        />
        <MultiSelect
          label="Tier"
          data={TIER_OPTIONS}
          value={filter.tiers}
          onChange={(values) => {
            onChange({ ...filter, tiers: narrowTiers(values) });
          }}
          placeholder={filter.tiers.length === 0 ? 'All tiers' : undefined}
          clearable
          w={180}
          aria-label="Filter by tier"
        />
        <Button
          variant="subtle"
          size="sm"
          leftSection={
            advancedOpen ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )
          }
          onClick={() => {
            setAdvancedOpen((v) => !v);
          }}
          aria-expanded={advancedOpen}
          aria-controls="audit-advanced-filters"
          data-testid="audit-advanced-toggle"
        >
          Advanced
        </Button>
      </Group>

      {/* Advanced row — actor + resource-id + date range */}
      <Collapse expanded={advancedOpen}>
        <Stack
          gap="sm"
          id="audit-advanced-filters"
          data-testid="audit-advanced-filters"
        >
          <Group gap="sm" align="flex-end" wrap="wrap">
            <div style={{ flex: 1, minWidth: 280 }}>
              <MultiSelectAsync
                label="Actors"
                placeholder="Search by name or email"
                value={filter.actor_handles}
                onChange={(handles) => {
                  onChange({ ...filter, actor_handles: handles });
                }}
                searchFn={actorSearchFn}
                aria-label="Filter by actor"
                data-testid="audit-actor-filter"
              />
            </div>
            <Select
              label="Resource type (for ID search)"
              data={RESOURCE_TYPE_OPTIONS}
              value={resourceTypeForSearch}
              onChange={(v) => {
                if (v) setResourceTypeForSearch(v);
              }}
              w={220}
              aria-label="Resource type for ID search"
            />
            <div style={{ flex: 1, minWidth: 280 }}>
              <MultiSelectAsync
                label="Resource IDs"
                placeholder="Search by resource id"
                value={filter.resource_id_handles}
                onChange={(handles) => {
                  onChange({ ...filter, resource_id_handles: handles });
                }}
                searchFn={resourceIdSearchFn}
                aria-label="Filter by resource id"
                data-testid="audit-resource-id-filter"
              />
            </div>
          </Group>
          <Group gap="sm" align="flex-end">
            <DatePickerInput
              type="range"
              label="Date range"
              placeholder="All dates"
              value={dateRangeValue}
              onChange={(val) => {
                const cast = val as [Date | null, Date | null];
                handleDateRange(cast);
              }}
              clearable
              w={320}
              aria-label="Filter by date range"
              data-testid="audit-date-range"
            />
          </Group>
        </Stack>
      </Collapse>
    </Stack>
  );
}
