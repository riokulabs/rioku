/**
 * AI Traces — daemon-backed hook smoke tests (T7).
 *
 * Covers list, get-by-id (sensitive fields gated), CSV export URL builder.
 * SSE live tail (`subscribeAITraceStream`) is wired to `EventSource`; we
 * smoke-test that the URL matches the daemon contract.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import {
  listAITraces,
  getAITrace,
  getExportAITracesCSVUrl,
  getStreamAITracesUrl,
} from '../daemon-hooks';

const TENANT = 'acme';
const BASE = `*/api/v1/t/${TENANT}/ai/traces`;

const sample = {
  id: 'aitrace-1',
  tenantId: 'tenant-acme',
  agentId: 'aiagent-1',
  providerId: 'aiprov-1',
  model: 'gpt-4o',
  status: 'success',
  inputTokens: 100,
  outputTokens: 50,
  durationMs: 250,
  prompt: null,
  completion: null,
  toolCalls: [],
  error: null,
  occurredAt: '2026-05-06T00:00:00.000Z',
};

describe('ai-traces daemon-hooks (T7)', () => {
  beforeEach(() => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ items: [sample], total: 1 })),
      http.get(`${BASE}/aitrace-1`, () =>
        HttpResponse.json({ ...sample, prompt: 'hi', completion: 'hello' }),
      ),
    );
  });

  it('lists traces', async () => {
    const res = (await listAITraces(TENANT)) as { data: { items: unknown[] } };
    expect(res.data.items).toHaveLength(1);
  });

  it('lists traces with status filter', async () => {
    server.use(
      http.get(BASE, ({ request }) => {
        const url = new URL(request.url);
        const status = url.searchParams.get('status');
        return HttpResponse.json({
          items: status === 'error' ? [] : [sample],
          total: status === 'error' ? 0 : 1,
        });
      }),
    );
    const res = (await listAITraces(TENANT, { status: 'error' })) as {
      data: { total: number };
    };
    expect(res.data.total).toBe(0);
  });

  it('returns sensitive fields when fetching by id', async () => {
    const res = (await getAITrace(TENANT, 'aitrace-1')) as unknown as {
      data: typeof sample & { prompt: string | null; completion: string | null };
    };
    expect(res.data.prompt).toBe('hi');
    expect(res.data.completion).toBe('hello');
  });

  it('builds the CSV export URL', () => {
    const url = getExportAITracesCSVUrl(TENANT);
    expect(url).toBe(`/api/v1/t/${TENANT}/ai/traces/export/csv`);
  });

  it('builds the SSE stream URL', () => {
    const url = getStreamAITracesUrl(TENANT);
    expect(url).toBe(`/api/v1/t/${TENANT}/ai/traces/stream`);
  });
});
