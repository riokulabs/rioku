/**
 * <DeliveryLogFilterBar> — status + channel + date-range + search filter for
 * the notification delivery log.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Group,
  MultiSelect,
  Stack,
  TextInput,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import type { NotificationDeliveryLogEntry } from '@/api/resources/types';
import type { DeliveryLogFilter } from '../types';

const STATUS_OPTIONS: { value: NotificationDeliveryLogEntry['status']; label: string }[] = [
  { value: 'delivered', label: 'Delivered' },
  { value: 'retrying', label: 'Retrying' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
];

const STATUS_SET: ReadonlySet<NotificationDeliveryLogEntry['status']> = new Set([
  'delivered',
  'retrying',
  'failed',
  'pending',
]);

function narrowStatuses(values: string[]): NotificationDeliveryLogEntry['status'][] {
  return values.filter((v): v is NotificationDeliveryLogEntry['status'] =>
    STATUS_SET.has(v as NotificationDeliveryLogEntry['status']),
  );
}

interface DeliveryLogFilterBarProps {
  tenantId: string;
  filter: DeliveryLogFilter;
  onChange: (next: DeliveryLogFilter) => void;
}

export function DeliveryLogFilterBar({
  tenantId,
  filter,
  onChange,
}: DeliveryLogFilterBarProps) {
  const channels = useMockStore((s) => s.notificationChannels);

  const channelOptions = useMemo(() => {
    return Object.values(channels)
      .filter((c) => c.tenant_id === tenantId)
      .map((c) => ({
        value: c.id,
        label: `${c.name} — ${c.kind}`,
      }));
  }, [channels, tenantId]);

  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      onChange({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, onChange]);

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
      const next: DeliveryLogFilter = {
        ...filter,
        date_from: from ? from.toISOString() : null,
        date_to: null,
      };
      if (to) {
        const endDate = new Date(to);
        // DatePickerInput yields midnight — push to end-of-day so the upper
        // bound is inclusive of the selected calendar day. Filter matcher
        // treats `date_to` as exclusive (`last_attempted_at >= date_to` rejects).
        endDate.setHours(23, 59, 59, 999);
        next.date_to = endDate.toISOString();
      }
      onChange(next);
    },
    [filter, onChange],
  );

  return (
    <Stack gap="xs" data-testid="delivery-log-filter-bar">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          placeholder="Search notification id or error…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.currentTarget.value);
          }}
          style={{ flex: 1, minWidth: 240 }}
          aria-label="Search delivery log"
        />
        <MultiSelect
          label="Status"
          data={STATUS_OPTIONS}
          value={filter.statuses}
          onChange={(values) => {
            onChange({ ...filter, statuses: narrowStatuses(values) });
          }}
          placeholder={filter.statuses.length === 0 ? 'All statuses' : undefined}
          clearable
          w={200}
          aria-label="Filter by status"
        />
        <MultiSelect
          label="Channels"
          data={channelOptions}
          value={filter.channel_ids}
          onChange={(values) => {
            onChange({ ...filter, channel_ids: values });
          }}
          placeholder={filter.channel_ids.length === 0 ? 'All channels' : undefined}
          searchable
          clearable
          w={260}
          aria-label="Filter by channel"
        />
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
          w={280}
          aria-label="Filter by date range"
        />
      </Group>
    </Stack>
  );
}
