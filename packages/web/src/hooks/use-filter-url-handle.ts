/**
 * useFilterUrlHandle — opaque handle ↔ filter-state bridge (in-memory).
 *
 * Syncs a typed filter object to the URL as a short opaque handle (`?f=<id>`)
 * instead of serialising the full filter into the query string.  This keeps
 * URLs short and prevents filter internals from leaking into browser history.
 *
 * IN-MEMORY CONSTRAINT
 * The handle store is a module-level `Map<string, unknown>`.  It is NOT
 * persisted to localStorage or the daemon.  Handles are lost on a full
 * page reload — on reload the URL `?f=<handle>` will not resolve and the hook
 * returns `filterState` (the default the caller passed in). Persisting the
 * handle daemon-side and fetching via TanStack Query would lift this
 * constraint.
 *
 * SEARCH-PARAM COUPLING
 * TanStack Router's `useSearch` requires a validated route schema per route.
 * Rather than coupling this generic hook to every route's schema, we use
 * `useSearch({ strict: false })` which reads the raw search string without
 * schema validation.  The hook reads only the `f` key; all other params are
 * ignored.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearch, useRouter } from '@tanstack/react-router';

// ── Module-level handle store ────────────────────────────────────────────────

const handleStore = new Map<string, unknown>();

/** Generate a short random handle (8 hex chars). */
function generateHandle(): string {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseFilterUrlHandleReturn<F> {
  /** The current opaque handle stored in the URL `?f=` param. */
  handle: string;
  /** The resolved filter object. */
  filter: F;
  /** Update the filter. Generates a new handle and navigates to `?f=<handle>`. */
  setFilter: (f: F) => void;
}

/**
 * @param filterState  The default filter to use when no handle is in the URL,
 *                     or when the handle cannot be resolved (e.g. after reload).
 */
export function useFilterUrlHandle<F>(filterState: F): UseFilterUrlHandleReturn<F> {
  // Read the raw `f` param without schema coupling.
  const search = useSearch({ strict: false });
  const urlHandle =
    typeof (search as Record<string, unknown>).f === 'string'
      ? ((search as Record<string, unknown>).f as string)
      : '';

  // useRouter gives us the router instance for imperative navigation.
  // We use it directly (rather than useNavigate) because this generic hook
  // sets a search param (`f`) that is not declared in any route's validateSearch
  // schema — navigate()'s strict types would reject it.  router.navigate
  // accepts a looser NavigateOptions type that allows arbitrary search params
  // when cast via the router instance.
  const router = useRouter();

  // Resolve the current filter from the store, or fall back to the default.
  const resolved: F = urlHandle
    ? ((handleStore.get(urlHandle) as F | undefined) ?? filterState)
    : filterState;

  // Reactive handle state — drives the returned `handle` value.
  const [currentHandle, setCurrentHandle] = useState<string>(urlHandle || '');

  // Stable ref mirrors the state so setFilter callbacks always close over
  // the latest value without needing it in their dependency arrays.
  const handleRef = useRef<string>(urlHandle || '');

  // On first render: if there is no handle in the URL, seed one for the
  // current default filter so callers always have a stable handle.
  useEffect(() => {
    if (handleRef.current) return; // URL already has a handle
    const newHandle = generateHandle();
    handleStore.set(newHandle, filterState);
    handleRef.current = newHandle;
    setCurrentHandle(newHandle);
    void router.navigate({
      search: (prev: Record<string, unknown>) => ({ ...prev, f: newHandle }),
      replace: true,
    } as Parameters<typeof router.navigate>[0]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setFilter(f: F): void {
    const newHandle = generateHandle();
    handleStore.set(newHandle, f);
    handleRef.current = newHandle;
    setCurrentHandle(newHandle);
    void router.navigate({
      search: (prev: Record<string, unknown>) => ({ ...prev, f: newHandle }),
    } as Parameters<typeof router.navigate>[0]);
  }

  return {
    handle: currentHandle,
    filter: resolved,
    setFilter,
  };
}
