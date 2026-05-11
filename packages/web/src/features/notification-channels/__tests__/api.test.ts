/**
 * Tests for the notification-channels API — daemon-backed (stage-2).
 *
 * Uses MSW to intercept fetch calls to /api/v1/t/:tenant/notification-channels.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { server } from '@/test/msw-server';

import {
  createChannel,
  deleteChannel,
  testChannel,
  updateChannel,
  useChannelDetail,
  useChannelList,
} from '../api';
import type { ChannelFilter } from '../types';

const TENANT = 'acme';
const TENANT_ID = 'tenant-001';

function setTenantUrl() {
  window.history.replaceState(null, '', `/t/${TENANT}/settings/notification-channels`);
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function emptyFilter(): ChannelFilter {
  return { kinds: [], enabled: undefined, search: '' };
}

const CHANNEL_EMAIL = {
  id: 'channel-email-1',
  tenantId: TENANT_ID,
  name: 'Ops email',
  kind: 'email' as const,
  config: { to: 'ops@example.com', from: 'no-reply@example.com' },
  enabled: true,
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
};

const CHANNEL_SLACK = {
  id: 'channel-slack-1',
  tenantId: TENANT_ID,
  name: 'Z-Slack ops',
  kind: 'slack' as const,
  config: { webhook_url: 'https://hooks.slack.com/services/T/B/C' },
  enabled: false,
  createdAt: '2026-01-02T10:00:00.000Z',
  updatedAt: '2026-01-02T10:00:00.000Z',
};

beforeEach(() => {
  setTenantUrl();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useChannelList', () => {
  it('lists channels sorted by name and filters by kind / enabled / search', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notification-channels`, () =>
        HttpResponse.json({ items: [CHANNEL_SLACK, CHANNEL_EMAIL], total: 2 }),
      ),
    );

    const qc = makeQueryClient();
    const { result, rerender } = renderHook(
      ({ filter }: { filter: ChannelFilter }) => useChannelList(TENANT_ID, filter),
      { wrapper: wrapper(qc), initialProps: { filter: emptyFilter() } },
    );

    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });
    // sorted asc by name
    expect(result.current[0]?.name).toBe('Ops email');
    expect(result.current[1]?.name).toBe('Z-Slack ops');

    rerender({ filter: { ...emptyFilter(), kinds: ['email'] } });
    expect(result.current.every((c) => c.kind === 'email')).toBe(true);

    rerender({ filter: { ...emptyFilter(), enabled: true } });
    expect(result.current.every((c) => c.enabled)).toBe(true);

    rerender({ filter: { ...emptyFilter(), search: 'slack' } });
    expect(result.current.every((c) => c.name.toLowerCase().includes('slack'))).toBe(true);
  });

  it('returns every row the daemon responds with (tenant scoping happens at the URL level)', async () => {
    // The previous defense-in-depth client filter compared the URL slug
    // (`acme`) against the daemon's internal id (`tenant_…`), which dropped
    // every row on non-default tenants — see notification-channels/api.ts.
    // The daemon already scopes the response to the URL tenant, so the
    // hook now returns whatever the daemon emits and leaves enforcement
    // server-side.
    const otherTenant = { ...CHANNEL_EMAIL, tenantId: 'tenant-other' };
    server.use(
      http.get(`/api/v1/t/${TENANT}/notification-channels`, () =>
        HttpResponse.json({ items: [otherTenant, CHANNEL_EMAIL], total: 2 }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useChannelList(TENANT_ID, emptyFilter()), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });
  });
});

describe('useChannelDetail', () => {
  it('fetches a channel by id', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notification-channels/${CHANNEL_EMAIL.id}`, () =>
        HttpResponse.json(CHANNEL_EMAIL),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useChannelDetail(CHANNEL_EMAIL.id), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => {
      expect(result.current?.id).toBe(CHANNEL_EMAIL.id);
    });
    expect(result.current?.name).toBe(CHANNEL_EMAIL.name);
  });
});

describe('createChannel', () => {
  it('POSTs to the daemon and returns the mapped channel', async () => {
    server.use(
      http.post(`/api/v1/t/${TENANT}/notification-channels`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.name).toBe('new-slack');
        expect(body.kind).toBe('slack');
        return HttpResponse.json(
          {
            ...CHANNEL_SLACK,
            id: 'channel-new-1',
            name: 'new-slack',
            enabled: true,
          },
          { status: 201 },
        );
      }),
    );
    const created = await createChannel({
      tenant_id: TENANT_ID,
      name: 'new-slack',
      kind: 'slack',
      config: { webhook_url: 'https://hooks.slack.com/services/T/B/C' },
    });
    expect(created.id).toBe('channel-new-1');
    expect(created.kind).toBe('slack');
  });

  it('rejects invalid per-kind config before calling the daemon', async () => {
    let called = false;
    server.use(
      http.post(`/api/v1/t/${TENANT}/notification-channels`, () => {
        called = true;
        return HttpResponse.json({}, { status: 200 });
      }),
    );
    await expect(
      createChannel({
        tenant_id: TENANT_ID,
        name: 'bad',
        kind: 'slack',
        config: { webhook_url: 'not-a-url' },
      }),
    ).rejects.toBeDefined();
    expect(called).toBe(false);
  });
});

describe('updateChannel', () => {
  it('PUTs and returns the updated channel', async () => {
    server.use(
      http.put(`/api/v1/t/${TENANT}/notification-channels/${CHANNEL_EMAIL.id}`, () =>
        HttpResponse.json({ ...CHANNEL_EMAIL, enabled: false, name: 'renamed' }),
      ),
    );
    const updated = await updateChannel(CHANNEL_EMAIL.id, {
      name: 'renamed',
      enabled: false,
    });
    expect(updated?.name).toBe('renamed');
    expect(updated?.enabled).toBe(false);
  });

  it('returns undefined on 404', async () => {
    server.use(
      http.put(`/api/v1/t/${TENANT}/notification-channels/nope`, () =>
        HttpResponse.json({ title: 'Not found' }, { status: 404 }),
      ),
    );
    const out = await updateChannel('nope', { name: 'x' });
    expect(out).toBeUndefined();
  });
});

describe('deleteChannel', () => {
  it('returns true on success', async () => {
    server.use(
      http.delete(
        `/api/v1/t/${TENANT}/notification-channels/${CHANNEL_EMAIL.id}`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const ok = await deleteChannel(CHANNEL_EMAIL.id);
    expect(ok).toBe(true);
  });

  it('returns false on error', async () => {
    server.use(
      http.delete(`/api/v1/t/${TENANT}/notification-channels/nope`, () =>
        HttpResponse.json({ title: 'gone' }, { status: 404 }),
      ),
    );
    const ok = await deleteChannel('nope');
    expect(ok).toBe(false);
  });
});

describe('testChannel', () => {
  it('reports success when the daemon stub returns ok=true', async () => {
    server.use(
      http.post(`/api/v1/t/${TENANT}/notification-channels/${CHANNEL_EMAIL.id}/test`, () =>
        HttpResponse.json({ channelId: CHANNEL_EMAIL.id, ok: true }),
      ),
    );
    const res = await testChannel(CHANNEL_EMAIL.id);
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
    expect(typeof res.latency_ms).toBe('number');
  });

  it('reports failure with an error message', async () => {
    server.use(
      http.post(`/api/v1/t/${TENANT}/notification-channels/${CHANNEL_EMAIL.id}/test`, () =>
        HttpResponse.json({ channelId: CHANNEL_EMAIL.id, ok: false, error: 'smtp denied' }),
      ),
    );
    const res = await testChannel(CHANNEL_EMAIL.id);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('smtp denied');
  });

  it('handles network/server errors', async () => {
    server.use(
      http.post(`/api/v1/t/${TENANT}/notification-channels/nope/test`, () =>
        HttpResponse.json({ title: 'not found' }, { status: 404 }),
      ),
    );
    const res = await testChannel('nope');
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });
});
