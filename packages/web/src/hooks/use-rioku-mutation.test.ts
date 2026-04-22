import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useRiokuMutation } from './use-rioku-mutation';
import { ValidationError, NetworkError, PermissionError, ServerError } from '@/api/errors';

// ─── Mock Mantine notifications ──────────────────────────────────────────────

vi.mock('@mantine/notifications', () => ({
  notifications: {
    show: vi.fn(),
  },
}));

import { notifications } from '@mantine/notifications';

// ─── Test wrapper ─────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
    qc,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useRiokuMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onSuccess when mutationFn resolves', async () => {
    const { wrapper } = makeWrapper();
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () =>
        useRiokuMutation({
          mutationFn: () => Promise.resolve({ ok: true }),
          onSuccess,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync(undefined);
    });

    // TanStack Query 5.x passes a 4th MutationContext arg; match the first 3.
    expect(onSuccess).toHaveBeenCalledWith({ ok: true }, undefined, undefined, expect.anything());
  });

  it('re-throws ValidationError without showing a toast', async () => {
    const { wrapper } = makeWrapper();
    const err = new ValidationError('Name is required', {
      fields: { name: ['required'] },
    });
    const { result } = renderHook(
      () =>
        useRiokuMutation({
          mutationFn: () => Promise.reject(err),
        }),
      { wrapper },
    );

    await expect(
      act(async () => {
        await result.current.mutateAsync(undefined);
      }),
    ).rejects.toThrow(ValidationError);

    expect(notifications.show).not.toHaveBeenCalled();
  });

  it('shows "Action denied" toast for PermissionError and re-throws', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useRiokuMutation({
          mutationFn: () => Promise.reject(new PermissionError()),
        }),
      { wrapper },
    );

    await expect(
      act(async () => {
        await result.current.mutateAsync(undefined);
      }),
    ).rejects.toThrow(PermissionError);

    await waitFor(() => {
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Action denied' }),
      );
    });
  });

  it('shows error toast with correlationId for NetworkError', async () => {
    const { wrapper } = makeWrapper();
    const netErr = new NetworkError({ correlationId: 'corr-abc-123' });
    const { result } = renderHook(
      () =>
        useRiokuMutation({
          mutationFn: () => Promise.reject(netErr),
        }),
      { wrapper },
    );

    await expect(
      act(async () => {
        await result.current.mutateAsync(undefined);
      }),
    ).rejects.toThrow(NetworkError);

    await waitFor(() => {
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Request failed',
          message: expect.stringContaining('corr-abc-123') as string,
        }),
      );
    });
  });

  it('shows error toast for ServerError', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useRiokuMutation({
          mutationFn: () => Promise.reject(new ServerError({ status: 503 })),
        }),
      { wrapper },
    );

    await expect(
      act(async () => {
        await result.current.mutateAsync(undefined);
      }),
    ).rejects.toThrow(ServerError);

    await waitFor(() => {
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Request failed' }),
      );
    });
  });

  it('calls onError with the thrown error', async () => {
    const { wrapper } = makeWrapper();
    const onError = vi.fn();
    const err = new NetworkError();
    const { result } = renderHook(
      () =>
        useRiokuMutation({
          mutationFn: () => Promise.reject(err),
          onError,
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined);
    });

    await waitFor(() => {
      // TanStack Query 5.x passes a 4th MutationContext arg; match the first 3.
      expect(onError).toHaveBeenCalledWith(err, undefined, undefined, expect.anything());
    });
  });
});
