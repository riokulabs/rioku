/**
 * Tests for the notification-log (delivery log) API — daemon-backed (stage-2).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { server } from '@/test/msw-server';

import { useDeliveryLogDetail, useDeliveryLogList } from '../api';
import type { DeliveryLogFilter } from '../types';

const TENANT = 'acme';
const TENANT_ID = 'tenant-001';

function setTenantUrl() {
  window.history.replaceState(null, '', `/t/${TENANT}/settings/notification-delivery`);
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
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

const ENTRY_OK = {
  id: 'log-1',
  tenantId: TENANT_ID,
  channelId: 'channel-email-1',
  notificationId: 'notif-1',
  status: 'delivered' as const,
  attempts: 1,
  firstAttemptedAt: '2026-04-01T10:00:00.000Z',
  lastAttemptedAt: '2026-04-01T10:00:00.500Z',
  lastError: null,
  metadata: {},
};
const ENTRY_FAIL = {
  id: 'log-2',
  tenantId: TENANT_ID,
  channelId: 'channel-slack-1',
  notificationId: 'notif-2',
  status: 'failed' as const,
  attempts: 3,
  firstAttemptedAt: '2026-04-02T10:00:00.000Z',
  lastAttemptedAt: '2026-04-02T10:00:02.500Z',
  lastError: 'connection refused',
  metadata: {},
};

beforeEach(() => {
  setTenantUrl();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDeliveryLogList', () => {
  it('lists entries sorted desc by last_attempted_at, mapped to client shape', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notification-log`, () =>
        HttpResponse.json({ items: [ENTRY_OK, ENTRY_FAIL], total: 2 }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useDeliveryLogList(TENANT_ID, emptyFilter()), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });
    // Latest first: ENTRY_FAIL (Apr 2) before ENTRY_OK (Apr 1).
    expect(result.current[0]?.id).toBe('log-2');
    expect(result.current[0]?.error_message).toBe('connection refused');
    expect(result.current[0]?.attempted_at).toBe(ENTRY_FAIL.lastAttemptedAt);
  });

  it('pushes single-status filter to server and applies multi-status client-side', async () => {
    let qsSeen = '';
    server.use(
      http.get(`/api/v1/t/${TENANT}/notification-log`, ({ request }) => {
        qsSeen = new URL(request.url).search;
        return HttpResponse.json({ items: [ENTRY_OK, ENTRY_FAIL], total: 2 });
      }),
    );
    const qc = makeQueryClient();
    const initialFilter: DeliveryLogFilter = { ...emptyFilter(), statuses: ['failed'] };
    const { result, rerender } = renderHook(
      ({ filter }: { filter: DeliveryLogFilter }) => useDeliveryLogList(TENANT_ID, filter),
      { wrapper: wrapper(qc), initialProps: { filter: initialFilter } },
    );
    await waitFor(() => {
      expect(result.current.length).toBe(1);
    });
    expect(qsSeen).toContain('status=failed');

    const both: DeliveryLogFilter = {
      ...emptyFilter(),
      statuses: ['failed', 'delivered'],
    };
    rerender({ filter: both });
    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });
  });

  it('filters by channel_id and date range client-side', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notification-log`, () =>
        HttpResponse.json({ items: [ENTRY_OK, ENTRY_FAIL], total: 2 }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(
      () =>
        useDeliveryLogList(TENANT_ID, {
          ...emptyFilter(),
          channel_ids: ['channel-email-1'],
          date_from: '2026-04-01T00:00:00.000Z',
          date_to: '2026-04-02T00:00:00.000Z',
        }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.length).toBe(1);
    });
    expect(result.current[0]?.id).toBe('log-1');
  });
});

describe('useDeliveryLogDetail', () => {
  it('fetches a single entry by id', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notification-log/${ENTRY_OK.id}`, () =>
        HttpResponse.json(ENTRY_OK),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useDeliveryLogDetail(ENTRY_OK.id), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => {
      expect(result.current?.id).toBe(ENTRY_OK.id);
    });
    expect(result.current?.status).toBe('delivered');
  });
});
