/**
 * CSV export — POST /traces/export?format=csv with streaming reader.
 *
 * Spec §7 RD5 requires a streaming reader (response.body.getReader())
 * and a Blob download. We assert:
 *   - request method is POST
 *   - the path includes ?format=csv
 *   - body is consumed via getReader() (we feed multiple chunks via
 *     a ReadableStream and confirm the resulting blob concatenates them)
 *   - blob mime is text/csv
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { exportTracesCsv } from '../api';
import type { TraceFilter } from '../types';

const TENANT = 'acme';

function emptyFilter(): TraceFilter {
  return { search: '', agent_ids: [], statuses: [] };
}

function urlToString(url: RequestInfo | URL): string {
  if (typeof url === 'string') return url;
  if (url instanceof URL) return url.href;
  return url.url;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exportTracesCsv (streaming)', () => {
  it('POSTs ?format=csv and assembles streamed chunks into a Blob', async () => {
    const chunks = [new TextEncoder().encode('header\n'), new TextEncoder().encode('row-1\n')];
    let captured: { method: string | undefined; url: string } = { method: undefined, url: '' };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });

    const fakeFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      captured = { method: init?.method, url: urlToString(url) };
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
      );
    });
    vi.stubGlobal('fetch', fakeFetch);

    const blob = await exportTracesCsv(TENANT, emptyFilter());
    expect(captured.method).toBe('POST');
    expect(captured.url).toContain('/api/v1/t/acme/ai/traces/export');
    expect(captured.url).toContain('format=csv');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain('text/csv');
    const text = await blob.text();
    expect(text).toContain('header');
    expect(text).toContain('row-1');
  });

  it('includes the status filter in the URL when exactly one status is set', async () => {
    let capturedUrl = '';
    const fakeFetch = vi.fn((url: RequestInfo | URL) => {
      capturedUrl = urlToString(url);
      return Promise.resolve(
        new Response('', { status: 200, headers: { 'content-type': 'text/csv' } }),
      );
    });
    vi.stubGlobal('fetch', fakeFetch);

    await exportTracesCsv(TENANT, { ...emptyFilter(), statuses: ['error'] });
    expect(capturedUrl).toContain('status=error');
  });

  it('throws when the daemon returns a non-2xx status', async () => {
    const fakeFetch = vi.fn(() => Promise.resolve(new Response('boom', { status: 500 })));
    vi.stubGlobal('fetch', fakeFetch);
    await expect(exportTracesCsv(TENANT, emptyFilter())).rejects.toThrow(/CSV export failed/);
  });

  it('falls back to arrayBuffer when response.body is null', async () => {
    const fakeFetch = vi.fn(() => {
      const res = new Response(null, { status: 200, headers: { 'content-type': 'text/csv' } });
      Object.defineProperty(res, 'body', { value: null });
      return Promise.resolve(res);
    });
    vi.stubGlobal('fetch', fakeFetch);
    const blob = await exportTracesCsv(TENANT, emptyFilter());
    expect(blob).toBeInstanceOf(Blob);
  });
});
