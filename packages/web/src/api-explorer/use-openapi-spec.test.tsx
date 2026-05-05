import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOpenAPISpec } from './use-openapi-spec';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

describe('useOpenAPISpec', () => {
  it('@read-only loads spec from /openapi.json', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ openapi: '3.0', info: { title: 'rioku', version: '1' }, paths: {} }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const { result } = renderHook(() => useOpenAPISpec(), { wrapper });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data?.info.title).toBe('rioku');
  });

  it('@read-only falls back to static spec on 404', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 404 }));
    const { result } = renderHook(() => useOpenAPISpec(), { wrapper });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.info).toBeDefined();
  });
});
