/**
 * Notification delivery log API — read-only (stage-2, daemon-backed).
 *
 * Routes:
 *   GET /api/v1/t/{tenant}/notification-log         list
 *   GET /api/v1/t/{tenant}/notification-log/{id}    detail
 *
 * Entries are written server-side by the channel-test path + (eventually)
 * the daemon notification dispatcher. The list endpoint accepts:
 *   ?status=<delivered|retrying|failed|pending>
 *   ?limit=<n>&offset=<n>
 *
 * Multi-status, multi-channel, date-range, and search filtering are applied
 * client-side after a single fetch — daemon currently exposes single-value
 * status only.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { resolveTenant } from '@/features/notifications/api';
import { customFetch } from '@/api/mutator';
import type { ID, NotificationDeliveryLogEntry } from '@/api/resources';

import type { DeliveryLogFilter } from './types';

// ─── Daemon DTO + mapper ──────────────────────────────────────────────────────

interface DaemonDeliveryLog {
  id: string;
  tenantId: string;
  channelId?: string | null;
  notificationId?: string | null;
  status: 'delivered' | 'retrying' | 'failed' | 'pending';
  attempts: number;
  firstAttemptedAt?: string | null;
  lastAttemptedAt?: string | null;
  lastError?: string | null;
  metadata: unknown;
}

interface ListLogResponse {
  items: DaemonDeliveryLog[];
  total: number;
}

function mapEntry(d: DaemonDeliveryLog): NotificationDeliveryLogEntry {
  const last = d.lastAttemptedAt ?? d.firstAttemptedAt ?? '';
  const first = d.firstAttemptedAt ?? last;
  return {
    id: d.id,
    tenant_id: d.tenantId,
    channel_id: d.channelId ?? '',
    notification_id: d.notificationId ?? '',
    status: d.status,
    attempts: d.attempts,
    ...(d.lastError ? { error_message: d.lastError, error: d.lastError } : {}),
    first_attempted_at: first,
    last_attempted_at: last,
    attempted_at: last,
  };
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const deliveryLogKeys = {
  all: (tenant: string) => ['notification-log', tenant] as const,
  list: (tenant: string, status: string) =>
    ['notification-log', tenant, 'list', status] as const,
  detail: (tenant: string, id: string) => ['notification-log', tenant, id] as const,
};

// ─── Filtering ────────────────────────────────────────────────────────────────

function matchesFilter(
  entry: NotificationDeliveryLogEntry,
  tenantId: ID,
  filter: DeliveryLogFilter,
): boolean {
  if (tenantId && entry.tenant_id !== tenantId) return false;
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

async function fetchLog(
  tenant: string,
  status: string,
): Promise<NotificationDeliveryLogEntry[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await customFetch<ListLogResponse>({
    url: `/t/${tenant}/notification-log${qs}`,
    method: 'GET',
  });
  return data.items.map(mapEntry);
}

export function useDeliveryLogList(
  tenantId: ID,
  filter: DeliveryLogFilter,
): NotificationDeliveryLogEntry[] {
  const tenant = resolveTenant();
  // Single-value status filter pushed to server; multi-value done client-side.
  const serverStatus = filter.statuses.length === 1 ? (filter.statuses[0] ?? '') : '';
  const { data } = useQuery({
    queryKey: deliveryLogKeys.list(tenant, serverStatus),
    queryFn: () => fetchLog(tenant, serverStatus),
    staleTime: 15_000,
    enabled: !!tenant,
  });
  return useMemo(() => {
    const items = (data ?? []).filter((e) => matchesFilter(e, tenantId, filter));
    items.sort(sortDesc);
    return items;
  }, [data, tenantId, filter]);
}

export function useDeliveryLogDetail(
  id: ID,
): NotificationDeliveryLogEntry | undefined {
  const tenant = resolveTenant();
  const { data } = useQuery({
    queryKey: deliveryLogKeys.detail(tenant, id),
    queryFn: () =>
      customFetch<DaemonDeliveryLog>({
        url: `/t/${tenant}/notification-log/${id}`,
        method: 'GET',
      }).then(mapEntry),
    staleTime: 60_000,
    enabled: !!tenant && !!id,
  });
  return data;
}

// ─── Infinite-list variant ───────────────────────────────────────────────────

export interface DeliveryLogInfiniteResult {
  data: NotificationDeliveryLogEntry[];
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetching: boolean;
}

/**
 * Paginated variant of {@link useDeliveryLogList}. Daemon returns up to its
 * configured page size; we slice client-side to mirror the TanStack Query
 * `useInfiniteQuery` shape expected by the table component.
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
