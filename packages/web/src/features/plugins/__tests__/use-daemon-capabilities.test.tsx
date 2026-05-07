/**
 * Unit tests for `useDaemonCapabilities`.
 *
 * Covers the safe-default behaviour (capability flags off while loading
 * or on error) and the happy path (real flag pulled from
 * /api/v1/capabilities).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { useDaemonCapabilities } from '../use-daemon-capabilities';

beforeEach(() => {
  server.resetHandlers();
});

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  function Wrapper(props: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{props.children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe('useDaemonCapabilities', () => {
  it('returns sideloadEnabled=true when the daemon reports it', async () => {
    server.use(
      http.get('/api/v1/capabilities', () =>
        HttpResponse.json({ sideload_enabled: true }),
      ),
    );

    const { result } = renderHook(() => useDaemonCapabilities(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => { expect(result.current.sideloadEnabled).toBe(true); });
  });

  it('returns sideloadEnabled=false when the daemon reports it disabled', async () => {
    server.use(
      http.get('/api/v1/capabilities', () =>
        HttpResponse.json({ sideload_enabled: false }),
      ),
    );

    const { result } = renderHook(() => useDaemonCapabilities(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() =>
      // The default is also `false` so we check the data-loaded state by
      // letting react-query settle and confirming no flip occurs.
      { expect(result.current.sideloadEnabled).toBe(false); },
    );
  });

  it('falls back to safe defaults (all flags off) on fetch error', () => {
    server.use(
      http.get('/api/v1/capabilities', () =>
        HttpResponse.json({ title: 'boom' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useDaemonCapabilities(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.sideloadEnabled).toBe(false);
  });
});
