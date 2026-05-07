 
/**
 * Tests for the notification-routing API — daemon-backed (stage-2).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { server } from '@/test/msw-server';

import {
  createRoutingRule,
  deleteRoutingRule,
  previewMatch,
  reorderRoutingRules,
  updateRoutingRule,
  useRoutingRuleDetail,
  useRoutingRuleList,
} from '../api';
import type { RoutingRuleFilter } from '../types';

const TENANT = 'acme';
const TENANT_ID = 'tenant-001';

function setTenantUrl() {
  window.history.replaceState(null, '', `/t/${TENANT}/settings/notification-routing`);
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

function emptyFilter(): RoutingRuleFilter {
  return { enabled: undefined, search: '' };
}

const RULE_A = {
  id: 'rule-1',
  tenantId: TENANT_ID,
  name: 'Security errors',
  eventFilter: { expr: 'security.* severity=error' },
  channelIds: ['channel-email-1'],
  enabled: true,
  orderHint: 100,
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
};
const RULE_B = {
  id: 'rule-2',
  tenantId: TENANT_ID,
  name: 'All audit',
  eventFilter: { expr: 'audit.*' },
  channelIds: ['channel-slack-1'],
  enabled: false,
  orderHint: 200,
  createdAt: '2026-01-02T10:00:00.000Z',
  updatedAt: '2026-01-02T10:00:00.000Z',
};

beforeEach(() => {
  setTenantUrl();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useRoutingRuleList', () => {
  it('lists rules in order_hint order and filters by enabled / search', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notification-routing`, () =>
        HttpResponse.json({ items: [RULE_B, RULE_A], total: 2 }),
      ),
    );
    const qc = makeQueryClient();
    const { result, rerender } = renderHook(
      ({ filter }: { filter: RoutingRuleFilter }) => useRoutingRuleList(TENANT_ID, filter),
      { wrapper: wrapper(qc), initialProps: { filter: emptyFilter() } },
    );
    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });
    expect(result.current[0]?.name).toBe('Security errors');
    expect(result.current[0]?.event_filter).toBe('security.* severity=error');

    rerender({ filter: { ...emptyFilter(), enabled: true } });
    expect(result.current.every((r) => r.enabled)).toBe(true);

    rerender({ filter: { ...emptyFilter(), search: 'audit' } });
    expect(result.current.every((r) => r.name.toLowerCase().includes('audit'))).toBe(true);
  });
});

describe('useRoutingRuleDetail', () => {
  it('fetches a rule by id', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notification-routing/${RULE_A.id}`, () =>
        HttpResponse.json(RULE_A),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useRoutingRuleDetail(RULE_A.id), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => {
      expect(result.current?.id).toBe(RULE_A.id);
    });
    expect(result.current?.event_filter).toBe('security.* severity=error');
  });
});

describe('createRoutingRule', () => {
  it('POSTs and returns the mapped rule', async () => {
    server.use(
      http.post(`/api/v1/t/${TENANT}/notification-routing`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.name).toBe('New rule');
        expect(body.eventFilter).toEqual({ expr: 'system.warn' });
        return HttpResponse.json(
          {
            ...RULE_A,
            id: 'rule-new',
            name: 'New rule',
            eventFilter: { expr: 'system.warn' },
          },
          { status: 201 },
        );
      }),
    );
    const created = await createRoutingRule({
      tenant_id: TENANT_ID,
      name: 'New rule',
      event_filter: 'system.warn',
      channel_ids: ['channel-email-1'],
    });
    expect(created.id).toBe('rule-new');
    expect(created.event_filter).toBe('system.warn');
  });
});

describe('updateRoutingRule', () => {
  it('PUTs and returns the updated rule; undefined on 404', async () => {
    server.use(
      http.put(`/api/v1/t/${TENANT}/notification-routing/${RULE_A.id}`, () =>
        HttpResponse.json({ ...RULE_A, name: 'renamed' }),
      ),
      http.put(`/api/v1/t/${TENANT}/notification-routing/nope`, () =>
        HttpResponse.json({ title: 'not found' }, { status: 404 }),
      ),
    );
    const upd = await updateRoutingRule(RULE_A.id, { name: 'renamed' });
    expect(upd?.name).toBe('renamed');
    const miss = await updateRoutingRule('nope', { name: 'x' });
    expect(miss).toBeUndefined();
  });
});

describe('deleteRoutingRule', () => {
  it('returns true on 204 / false on error', async () => {
    server.use(
      http.delete(`/api/v1/t/${TENANT}/notification-routing/${RULE_A.id}`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
      http.delete(`/api/v1/t/${TENANT}/notification-routing/nope`, () =>
        HttpResponse.json({ title: 'gone' }, { status: 404 }),
      ),
    );
    expect(await deleteRoutingRule(RULE_A.id)).toBe(true);
    expect(await deleteRoutingRule('nope')).toBe(false);
  });
});

describe('reorderRoutingRules', () => {
  it('PUTs the orderedIds and re-fetches the list', async () => {
    let putBody: unknown = null;
    server.use(
      http.put(`/api/v1/t/${TENANT}/notification-routing/order`, async ({ request }) => {
        putBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`/api/v1/t/${TENANT}/notification-routing`, () =>
        HttpResponse.json({
          items: [
            { ...RULE_B, orderHint: 100 },
            { ...RULE_A, orderHint: 200 },
          ],
          total: 2,
        }),
      ),
    );
    const out = await reorderRoutingRules(TENANT_ID, [RULE_B.id, RULE_A.id]);
    expect(putBody).toEqual({ orderedIds: [RULE_B.id, RULE_A.id] });
    expect(out.length).toBe(2);
    expect(out[0]?.id).toBe(RULE_B.id);
  });

  it('short-circuits on empty input', async () => {
    let called = false;
    server.use(
      http.put(`/api/v1/t/${TENANT}/notification-routing/order`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const out = await reorderRoutingRules(TENANT_ID, []);
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });
});

describe('previewMatch', () => {
  it('matches "*" against any event', () => {
    expect(
      previewMatch('*', { category: 'audit.create', severity: 'info' }).match,
    ).toBe(true);
  });
  it('prefix matches', () => {
    expect(
      previewMatch('audit.*', { category: 'audit.create', severity: 'info' }).match,
    ).toBe(true);
    expect(
      previewMatch('audit.*', { category: 'system.boot', severity: 'info' }).match,
    ).toBe(false);
  });
  it('AND-combines tokens', () => {
    expect(
      previewMatch('security.* severity=error', {
        category: 'security.login',
        severity: 'error',
      }).match,
    ).toBe(true);
    expect(
      previewMatch('security.* severity=error', {
        category: 'security.login',
        severity: 'warn',
      }).match,
    ).toBe(false);
  });
  it('empty expression is a non-match', () => {
    expect(previewMatch('', { category: 'x', severity: 'info' }).match).toBe(false);
  });
});
