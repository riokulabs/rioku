/**
 * <ApiExplorer> — Scalar API reference renderer for the merged OpenAPI
 * snapshot.
 *
 * Scalar ships its own Vue internals as a React wrapper; it uses browser
 * globals (IntersectionObserver etc.) that don't exist in jsdom, so the
 * unit tests for this component mock the `@scalar/api-reference-react`
 * module. The production bundle lands in a lazy chunk via the route-level
 * dynamic import — see `src/routes/t.$tenant/api-explorer.tsx`.
 *
 * Theme notes:
 *   - We use `theme: 'none'` so that Scalar's CSS variables are fully
 *     overridden by the scoped mapping below, which wires them to Mantine's
 *     design tokens.  This makes the explorer track the admin panel's color
 *     scheme automatically (dark ↔ light).
 *   - The `darkMode` boolean is passed explicitly so Scalar's internal logic
 *     also flips — some elements (e.g. syntax highlighting) read this prop
 *     rather than CSS variables.
 *   - On unmount we reset the global scrollbar properties that Scalar's
 *     style.css injects onto <html>/<body>.  Without this cleanup the
 *     browser scrollbar stays styled dark after navigating away from the
 *     explorer.
 *
 * Try-it / destructive-verb confirm:
 *   Scalar exposes a `fetch` configuration prop that replaces the built-in
 *   fetch call. We intercept it here: GET/HEAD/OPTIONS pass through immediately;
 *   POST/PUT/PATCH/DELETE open the DestructiveConfirmModal and await user
 *   confirmation before forwarding to the real fetch. If the user cancels, we
 *   reject with an AbortError so Scalar treats it as a cancelled request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Loader, Stack, Text, useComputedColorScheme } from '@mantine/core';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { useOpenAPISpec } from '@/api-explorer/use-openapi-spec';
import { DestructiveConfirmModal } from '@/api-explorer/destructive-confirm-modal';

const DESTRUCTIVE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface PendingRequest {
  method: string;
  path: string;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

export function ApiExplorer() {
  const colorScheme = useComputedColorScheme('dark');
  const isDark = colorScheme === 'dark';

  const { data: spec, isPending, isError, error } = useOpenAPISpec();

  const [pending, setPending] = useState<PendingRequest | null>(null);

  /**
   * Stable ref to the setter so the `customScalarFetch` closure (created once
   * via `useCallback`) can always reach the latest `setPending` without being
   * listed as a dependency and without re-creating the function on every render.
   * Assignment lives in a `useLayoutEffect` to satisfy the react-hooks/refs rule
   * (refs must not be written during render).
   */
  const setPendingRef = useRef<((req: PendingRequest) => void) | null>(null);
  useEffect(() => {
    setPendingRef.current = (req: PendingRequest) => { setPending(req); };
  });

  /** Mirror of the `pending` state into a ref so the unmount cleanup can read it. */
  const pendingRef = useRef<PendingRequest | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    return () => {
      // On unmount: if a destructive-confirm modal is pending, reject the
      // promise inside Scalar's customScalarFetch so it doesn't hang forever.
      const p = pendingRef.current;
      if (p !== null) {
        p.reject(new DOMException('cancelled', 'AbortError'));
        pendingRef.current = null;
      }
    };
  }, []);

  const handleCancel = useCallback(() => {
    if (pending) {
      pending.reject(new DOMException('Request cancelled by user', 'AbortError'));
      setPending(null);
    }
  }, [pending]);

  const handleConfirm = useCallback(() => {
    if (pending) {
      pending.resolve();
      setPending(null);
    }
  }, [pending]);

  /**
   * Custom fetch passed to Scalar's `fetch` configuration prop.
   * Destructive verbs (POST/PUT/PATCH/DELETE) are gated behind a confirm
   * modal before the real fetch call proceeds.
   */
  const customScalarFetch = useCallback(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      let path: string;
      try {
        path = new URL(rawUrl).pathname;
      } catch {
        path = rawUrl;
      }

      if (DESTRUCTIVE_METHODS.has(method)) {
        await new Promise<void>((resolve, reject) => {
          setPendingRef.current?.({ method, path, resolve, reject });
        });
      }

      return fetch(input, init);
    },
    [],
  );

  // Cleanup: undo global scrollbar styles that Scalar's style.css injects.
  // These persist on <html> after the component unmounts, causing the
  // scrollbar to remain dark until a hard page refresh.
  useEffect(() => {
    return () => {
      document.documentElement.style.scrollbarColor = '';
      document.documentElement.style.scrollbarWidth = '';
      document.body.style.scrollbarColor = '';
      document.body.style.scrollbarWidth = '';
    };
  }, []);

  if (isPending) {
    return (
      <Stack align="center" justify="center" style={{ minHeight: '100vh' }}>
        <Loader size="lg" />
        <Text c="dimmed">Loading API reference…</Text>
      </Stack>
    );
  }

  if (isError) {
    return (
      <Alert color="red" title="Failed to load OpenAPI spec" m="md">
        {error instanceof Error ? error.message : 'Unknown error'}
      </Alert>
    );
  }

  return (
    <>
      {/*
       * Scoped CSS variable mapping: wire Scalar's design tokens to Mantine's.
       * Targeting [data-testid="api-explorer"] keeps these overrides scoped to
       * the Scalar container and avoids polluting the global namespace.
       *
       * All values reference Mantine's computed CSS variables so they
       * automatically respond to dark/light mode switches.
       */}
      <style>{`
        [data-testid="api-explorer"] {
          --scalar-background-1: var(--mantine-color-body);
          --scalar-background-2: var(--mantine-color-default);
          --scalar-background-3: var(--mantine-color-default-hover);
          --scalar-color-1: var(--mantine-color-text);
          --scalar-color-2: var(--mantine-color-dimmed);
          --scalar-color-3: var(--mantine-color-dimmed);
          --scalar-border-color: var(--mantine-color-default-border);
          --scalar-scrollbar-color: var(--mantine-color-default-border);
          --scalar-scrollbar-color-active: var(--mantine-color-dimmed);
        }
      `}</style>
      <div data-testid="api-explorer" style={{ height: '100%', minHeight: '100vh' }}>
        <ApiReferenceReact
          configuration={{
            content: spec as unknown as Record<string, unknown>,
            theme: 'none',
            darkMode: isDark,
            hideDownloadButton: false,
            fetch: customScalarFetch,
          }}
        />
      </div>
      <DestructiveConfirmModal
        open={pending !== null}
        method={pending?.method ?? ''}
        path={pending?.path ?? ''}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />
    </>
  );
}
