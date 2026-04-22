/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the notification-log (delivery log) read-only API.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';

import { useDeliveryLogDetail, useDeliveryLogList, useDeliveryLogListInfinite } from '../api';
import type { DeliveryLogFilter } from '../types';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function firstTenantId(): string {
  return Object.keys(useMockStore.getState().tenants)[0]!;
}

function emptyFilter(): DeliveryLogFilter {
  return {
    statuses: [],
    channel_ids: [],
    date_from: null,
    date_to: null,
    search: '',
  };
}

describe('useDeliveryLogList', () => {
  it('returns entries scoped to the tenant, sorted desc by last_attempted_at', () => {
    const tenantId = firstTenantId();
    const { result } = renderHook(() => useDeliveryLogList(tenantId, emptyFilter()));
    for (const e of result.current) expect(e.tenant_id).toBe(tenantId);
    for (let i = 1; i < result.current.length; i++) {
      expect(result.current[i - 1]!.last_attempted_at >= result.current[i]!.last_attempted_at).toBe(
        true,
      );
    }
  });

  it('status filter narrows result set', () => {
    const tenantId = firstTenantId();
    const { result } = renderHook(() =>
      useDeliveryLogList(tenantId, { ...emptyFilter(), statuses: ['failed'] }),
    );
    for (const e of result.current) expect(e.status).toBe('failed');
  });

  it('channel filter narrows result set', () => {
    const tenantId = firstTenantId();
    const s = useMockStore.getState();
    const someEntry = Object.values(s.notificationDeliveryLog).find(
      (e) => e.tenant_id === tenantId,
    )!;
    const { result } = renderHook(() =>
      useDeliveryLogList(tenantId, { ...emptyFilter(), channel_ids: [someEntry.channel_id] }),
    );
    for (const e of result.current) expect(e.channel_id).toBe(someEntry.channel_id);
  });

  it('date_from bound filters earlier entries', () => {
    const tenantId = firstTenantId();
    const cutoff = new Date().toISOString();
    const { result } = renderHook(() =>
      useDeliveryLogList(tenantId, { ...emptyFilter(), date_from: cutoff }),
    );
    // cutoff = now; seeded entries are all older, so result should be empty.
    expect(result.current.length).toBe(0);
  });
});

describe('useDeliveryLogDetail', () => {
  it('returns the stored entry', () => {
    const [id] = Object.keys(useMockStore.getState().notificationDeliveryLog);
    const { result } = renderHook(() => useDeliveryLogDetail(id!));
    expect(result.current?.id).toBe(id);
  });
});

describe('useDeliveryLogListInfinite', () => {
  it('starts at pageSize and advances on fetchNextPage', () => {
    const tenantId = firstTenantId();
    const { result, rerender } = renderHook(() =>
      useDeliveryLogListInfinite(tenantId, emptyFilter(), 5),
    );
    const initial = result.current.data.length;
    expect(initial).toBeLessThanOrEqual(5);
    if (result.current.hasNextPage) {
      result.current.fetchNextPage();
      rerender();
      expect(result.current.data.length).toBeGreaterThan(initial);
    }
  });
});
