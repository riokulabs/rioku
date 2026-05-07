 
/**
 * Stage-2 tests for the AI semantic rate-limits API layer. Covers CRUD,
 * deterministic metrics shape, and the deprecated `simulateMatch` shim.
 *
 * Endpoint flow goes through MSW-backed Orval handlers (registered in
 * `src/test/msw-server.ts`); per-test handlers override response bodies.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { server } from '@/test/msw-server';
import {
  createRateLimit,
  updateRateLimit,
  deleteRateLimit,
  simulateMatch,
  useRateLimitList,
  useRateLimitDetail,
  useRateLimitMetricsRaw,
} from '../api';

const TENANT = 'tenant_acme';
const BASE = `*/api/v1/t/${TENANT}/ai/rate-limits`;

const sampleProto = {
  id: 'rl-1',
  tenantId: TENANT,
  name: 'tier-pro',
  scope: 'tenant',
  exemplars: ['drop table users'],
  similarityThreshold: 0.85,
  windowSeconds: 60,
  threshold: 10,
  action: 'block',
  enabled: true,
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
};

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function QcWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  }
  return QcWrapper;
}

beforeEach(() => {
  server.use(
    http.get(BASE, () => HttpResponse.json({ items: [sampleProto], total: 1 })),
    http.get(`${BASE}/rl-1`, () => HttpResponse.json(sampleProto)),
    http.post(BASE, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(
        { ...sampleProto, ...body, id: 'rl-new' },
        { status: 201 },
      );
    }),
    http.put(`${BASE}/rl-1`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...sampleProto, ...body });
    }),
    http.delete(`${BASE}/rl-1`, () => new HttpResponse(null, { status: 204 })),
    http.get(`${BASE}/rl-1/metrics`, () =>
      HttpResponse.json({
        rate_limit_id: 'rl-1',
        since: '24h',
        points: Array.from({ length: 24 }, (_, i) => ({
          timestamp: new Date(Date.UTC(2026, 4, 5 + i)).toISOString(),
          throttle_events: i,
        })),
      }),
    ),
  );
});

describe('CRUD imperatives', () => {
  it('createRateLimit POSTs to the daemon and returns admin shape', async () => {
    const rule = await createRateLimit(TENANT, {
      name: 'no-sql-drop',
      scope: 'tenant',
      exemplars: ['drop table users'],
      similarity_threshold: 0.5,
      window_seconds: 60,
      max_matches: 3,
      action: 'block',
    });
    expect(rule.id).toBe('rl-new');
    expect(rule.tenant_id).toBe(TENANT);
    expect(rule.scope).toBe('tenant');
  });

  it('updateRateLimit requires tenant + id and returns updated rule', async () => {
    const rule = await updateRateLimit(TENANT, 'rl-1', { action: 'degrade' });
    expect(rule.action).toBe('degrade');
  });

  it('deleteRateLimit returns void on 204', async () => {
    await expect(deleteRateLimit(TENANT, 'rl-1')).resolves.toBeUndefined();
  });
});

describe('useRateLimitList — viewer gating + filter', () => {
  it('returns rules from the daemon adapted to admin shape', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useRateLimitList(TENANT, { search: '', scopes: [], actions: [] }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });
    expect(result.current[0]!.name).toBe('tier-pro');
    expect(result.current[0]!.max_matches).toBe(10); // proto.threshold → admin.max_matches
  });

  it('client-side filter excludes rules whose action is not in `actions`', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useRateLimitList(TENANT, { search: '', scopes: [], actions: ['log'] }),
      { wrapper },
    );
    await waitFor(() => {
      // The list query will resolve to 0 results because the only rule's
      // action is `block`, not `log`. We just want a stable resolved state
      // (length is the proxy for "fetch settled").
      expect(Array.isArray(result.current)).toBe(true);
    });
    expect(result.current.length).toBe(0);
  });

  it('useRateLimitDetail fetches a single rule', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useRateLimitDetail(TENANT, 'rl-1'), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    expect(result.current!.name).toBe('tier-pro');
  });
});

describe('useRateLimitMetricsRaw', () => {
  it('returns the daemon point series with `throttle_events` populated', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useRateLimitMetricsRaw(TENANT, 'rl-1', '24h'), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.length).toBe(24);
    });
    expect(result.current[0]!.throttle_events).toBeGreaterThanOrEqual(0);
    expect(typeof result.current[0]!.timestamp).toBe('string');
  });
});

describe('simulateMatch (legacy shim)', () => {
  it('returns the deterministic no-match result so legacy callers do not crash', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional shim contract test
    const r = simulateMatch('rl-1', 'anything');
    expect(r.matched).toBe(false);
    expect(r.score).toBe(0);
  });
});
