/**
 * AI Rate-Limits — daemon-backed hook smoke tests (T6).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import {
  listAIRateLimits,
  getAIRateLimit,
  createAIRateLimit,
  updateAIRateLimit,
  deleteAIRateLimit,
  simulateAIRateLimit,
  getAIRateLimitMetrics,
} from '../daemon-hooks';

const TENANT = 'acme';
const BASE = `*/api/v1/t/${TENANT}/ai/rate-limits`;

const sample = {
  id: 'rl-1',
  tenantId: 'tenant-acme',
  name: 'tier-pro',
  scope: 'agent',
  agentId: 'aiagent-1',
  toolId: null,
  exemplars: ['hello world'],
  similarityThreshold: 0.85,
  windowSeconds: 60,
  threshold: 10,
  action: 'reject',
  enabled: true,
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
};

describe('ai-rate-limits daemon-hooks (T6)', () => {
  beforeEach(() => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ items: [sample], total: 1 })),
      http.get(`${BASE}/rl-1`, () => HttpResponse.json(sample)),
      http.post(BASE, () => HttpResponse.json({ ...sample, id: 'rl-new' }, { status: 201 })),
      http.put(`${BASE}/rl-1`, () => HttpResponse.json({ ...sample, threshold: 99 })),
      http.delete(`${BASE}/rl-1`, () => new HttpResponse(null, { status: 204 })),
      http.post(`${BASE}/rl-1/simulate`, () =>
        HttpResponse.json({ rateLimitId: 'rl-1', hits: 0, window: '1h' }),
      ),
      http.get(`${BASE}/rl-1/metrics`, () =>
        HttpResponse.json({
          rateLimitId: 'rl-1',
          current: 3,
          limit: 10,
          resetSeconds: 30,
        }),
      ),
    );
  });

  it('lists rate limits', async () => {
    const res = (await listAIRateLimits(TENANT)) as { data: { items: unknown[] } };
    expect(res.data.items).toHaveLength(1);
  });

  it('gets a rate limit', async () => {
    const res = (await getAIRateLimit(TENANT, 'rl-1')) as { data: typeof sample };
    expect(res.data.scope).toBe('agent');
  });

  it('creates a rate limit', async () => {
    const res = (await createAIRateLimit(TENANT, {
      name: 'x',
      scope: 'tool',
    })) as { data: typeof sample };
    expect(res.data.id).toBe('rl-new');
  });

  it('updates a rate limit', async () => {
    const res = (await updateAIRateLimit(TENANT, 'rl-1', { threshold: 99 })) as {
      data: typeof sample;
    };
    expect(res.data.threshold).toBe(99);
  });

  it('deletes a rate limit', async () => {
    const res = (await deleteAIRateLimit(TENANT, 'rl-1')) as { status: number };
    expect(res.status).toBe(204);
  });

  it('simulates a rate limit', async () => {
    const res = (await simulateAIRateLimit(TENANT, 'rl-1')) as unknown as {
      data: { rateLimitId: string; hits: number };
    };
    expect(res.data.rateLimitId).toBe('rl-1');
  });

  it('reads metrics', async () => {
    const res = (await getAIRateLimitMetrics(TENANT, 'rl-1')) as unknown as {
      data: { current: number; limit: number };
    };
    expect(res.data.limit).toBe(10);
  });
});
