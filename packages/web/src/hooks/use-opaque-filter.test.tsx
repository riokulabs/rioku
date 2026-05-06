import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOpaqueFilter } from './use-opaque-filter';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useOpaqueFilter', () => {
  it('@read-only registers a sensitive value and returns its handle', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ handle: 'oh_abc123' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { result } = renderHook(() => useOpaqueFilter('user-email@example.com', 'tnt-1'), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.handle).toBe('oh_abc123');
    });
    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ value: 'user-email@example.com' });
  });

  it('@read-only propagates errors instead of falling back to a placeholder', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 500 }));
    const { result } = renderHook(() => useOpaqueFilter('value', 'tnt-1'), { wrapper });
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
    expect(result.current.handle).toBeNull();
  });

  it('@read-only deduplicates calls to the same value', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ handle: 'oh_dedupe' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { result, rerender } = renderHook(({ v }: { v: string }) => useOpaqueFilter(v, 'tnt-1'), {
      wrapper,
      initialProps: { v: 'same-value' },
    });
    await waitFor(() => {
      expect(result.current.handle).toBe('oh_dedupe');
    });
    rerender({ v: 'same-value' });
    await waitFor(() => {
      expect(result.current.handle).toBe('oh_dedupe');
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
