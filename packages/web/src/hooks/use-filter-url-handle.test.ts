import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mock TanStack Router ─────────────────────────────────────────────────────

let mockSearch: Record<string, unknown> = {};
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockSearch,
  useRouter: () => ({ navigate: mockNavigate }),
}));

// Import after mocks
import { useFilterUrlHandle } from './use-filter-url-handle';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface TestFilter {
  status: string;
  page: number;
}

const DEFAULT_FILTER: TestFilter = { status: 'active', page: 1 };
const ALT_FILTER: TestFilter = { status: 'inactive', page: 2 };

describe('useFilterUrlHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = {};
    // Reset the module-level handle store between tests by clearing via
    // the same module import. Because the store is module-level state,
    // we manipulate it indirectly through the hook.
  });

  it('returns the default filter on first render when no URL handle', () => {
    const { result } = renderHook(() => useFilterUrlHandle(DEFAULT_FILTER));
    expect(result.current.filter).toEqual(DEFAULT_FILTER);
  });

  it('generates a handle and updates URL on first render', async () => {
    renderHook(() => useFilterUrlHandle(DEFAULT_FILTER));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
    const navCall = mockNavigate.mock.calls[0] as [
      { search: (prev: Record<string, unknown>) => Record<string, unknown>; replace: boolean },
    ];
    const searchResult = navCall[0].search({});
    expect(typeof searchResult.f).toBe('string');
    expect((searchResult.f as string).length).toBeGreaterThan(0);
    expect(navCall[0].replace).toBe(true);
  });

  it('calling setFilter creates a new handle and navigates', () => {
    const { result } = renderHook(() => useFilterUrlHandle(DEFAULT_FILTER));

    act(() => {
      result.current.setFilter(ALT_FILTER);
    });

    expect(mockNavigate).toHaveBeenCalled();
    // Find the setFilter navigate call (not replace=true, which is the init call)
    const setFilterCall = mockNavigate.mock.calls.find(
      (call) => !(call[0] as { replace?: boolean }).replace,
    ) as [{ search: (prev: Record<string, unknown>) => Record<string, unknown> }] | undefined;
    expect(setFilterCall).toBeDefined();
    if (!setFilterCall) throw new Error('setFilter navigate not called');
    const searchResult = setFilterCall[0].search({});
    expect(typeof searchResult.f).toBe('string');
  });

  it('resolves filter from existing URL handle on mount', () => {
    // Pre-populate the store by running setFilter first in a separate hook
    // instance, then simulate the URL handle being present on mount.

    // Step 1: run the hook, set a filter to store it
    const { result: r1 } = renderHook(() => useFilterUrlHandle(DEFAULT_FILTER));
    act(() => {
      r1.current.setFilter(ALT_FILTER);
    });

    // Step 2: capture the handle that was stored in the URL
    const setFilterNavCall = mockNavigate.mock.calls.find(
      (call) => !(call[0] as { replace?: boolean }).replace,
    ) as [{ search: (prev: Record<string, unknown>) => Record<string, unknown> }] | undefined;
    if (!setFilterNavCall) throw new Error('No setFilter navigate call found');
    const storedHandle = setFilterNavCall[0].search({}).f as string;

    // Step 3: simulate the URL having that handle
    mockSearch = { f: storedHandle };
    mockNavigate.mockClear();

    const { result: r2 } = renderHook(() => useFilterUrlHandle(DEFAULT_FILTER));
    // The hook should resolve to the stored ALT_FILTER
    expect(r2.current.filter).toEqual(ALT_FILTER);
  });

  it('falls back to default filter when URL handle is unknown (e.g. after reload)', () => {
    // Provide a handle that was never stored
    mockSearch = { f: 'deadbeef' };
    const { result } = renderHook(() => useFilterUrlHandle(DEFAULT_FILTER));
    expect(result.current.filter).toEqual(DEFAULT_FILTER);
  });

  it('handle in the URL is not navigated away from on init when already set', async () => {
    mockSearch = { f: 'existinghandle' };
    renderHook(() => useFilterUrlHandle(DEFAULT_FILTER));
    // Should NOT call navigate to replace the URL when a handle already exists
    await new Promise((r) => setTimeout(r, 10));
    const replaceCalls = mockNavigate.mock.calls.filter(
      (call) => (call[0] as { replace?: boolean }).replace === true,
    );
    expect(replaceCalls).toHaveLength(0);
  });

  it('exposes the current handle string', async () => {
    const { result } = renderHook(() => useFilterUrlHandle(DEFAULT_FILTER));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
    act(() => {
      result.current.setFilter(ALT_FILTER);
    });
    // After setFilter the handle ref should be updated
    expect(typeof result.current.handle).toBe('string');
    expect(result.current.handle.length).toBeGreaterThan(0);
  });
});
