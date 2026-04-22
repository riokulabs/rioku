/**
 * Notification delivery log API — read-only. No CRUD; entries are written
 * by the channel-test path + (in Stage 2) the daemon dispatcher.
 */
import { useCallback, useMemo, useState } from 'react';

import { useMockStore } from '@/api/mock-store';
import type { ID, NotificationDeliveryLogEntry } from '@/api/resources/types';

import type { DeliveryLogFilter } from './types';

// ─── Filter matcher ──────────────────────────────────────────────────────────

function matchesFilter(
  entry: NotificationDeliveryLogEntry,
  tenantId: ID,
  filter: DeliveryLogFilter,
): boolean {
  if (entry.tenant_id !== tenantId) return false;
  if (filter.statuses.length > 0 && !filter.statuses.includes(entry.status)) return false;
  if (filter.channel_ids.length > 0 && !filter.channel_ids.includes(entry.channel_id)) return false;
  if (filter.date_from !== null && entry.last_attempted_at < filter.date_from) return false;
  if (filter.date_to !== null && entry.last_attempted_at >= filter.date_to) return false;
  const search = filter.search.trim().toLowerCase();
  if (search) {
    const hay = `${entry.notification_id} ${entry.error_message ?? ''}`.toLowerCase();
    if (!hay.includes(search)) return false;
  }
  return true;
}

function sortDesc(a: NotificationDeliveryLogEntry, b: NotificationDeliveryLogEntry): number {
  return a.last_attempted_at < b.last_attempted_at
    ? 1
    : a.last_attempted_at > b.last_attempted_at
      ? -1
      : 0;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useDeliveryLogList(
  tenantId: ID,
  filter: DeliveryLogFilter,
): NotificationDeliveryLogEntry[] {
  const log = useMockStore((s) => s.notificationDeliveryLog);
  return useMemo(() => {
    const out: NotificationDeliveryLogEntry[] = [];
    for (const e of Object.values(log)) {
      if (matchesFilter(e, tenantId, filter)) out.push(e);
    }
    out.sort(sortDesc);
    return out;
  }, [log, tenantId, filter]);
}

export function useDeliveryLogDetail(id: ID): NotificationDeliveryLogEntry | undefined {
  return useMockStore((s) => s.notificationDeliveryLog[id]);
}

// ─── Infinite-list variant ───────────────────────────────────────────────────

export interface DeliveryLogInfiniteResult {
  data: NotificationDeliveryLogEntry[];
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetching: boolean;
}

/**
 * Paginated variant of {@link useDeliveryLogList}. Mirrors the TanStack
 * Query `useInfiniteQuery` shape.
 */
export function useDeliveryLogListInfinite(
  tenantId: ID,
  filter: DeliveryLogFilter,
  pageSize: number,
): DeliveryLogInfiniteResult {
  const full = useDeliveryLogList(tenantId, filter);
  const [pages, setPages] = useState(1);
  const currentSlice = useMemo(() => full.slice(0, pages * pageSize), [full, pages, pageSize]);
  const hasNextPage = currentSlice.length < full.length;
  const fetchNextPage = useCallback(() => {
    setPages((p) => p + 1);
  }, []);
  return {
    data: currentSlice,
    fetchNextPage,
    hasNextPage,
    isFetching: false,
  };
}
