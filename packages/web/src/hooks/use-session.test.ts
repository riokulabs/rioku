/**
 * useSession tests.
 *
 * Mocks useMockStore to avoid Zustand persistence side-effects.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// ─── Mock state helpers ───────────────────────────────────────────────────────

interface SelectorState {
  currentUserId: string | null;
  currentTenantId: string | null;
}

let mockState: SelectorState = { currentUserId: null, currentTenantId: null };

vi.mock('../api/mock-store', () => ({
  useMockStore: (selector: (s: SelectorState) => unknown) => selector(mockState),
}));

// Import AFTER mocks
import { useSession } from './use-session';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useSession', () => {
  it('returns nulls and isAuthenticated=false when no user is set', () => {
    mockState = { currentUserId: null, currentTenantId: null };
    const { result } = renderHook(() => useSession());
    expect(result.current.currentUserId).toBeNull();
    expect(result.current.currentTenantId).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('returns currentUserId and isAuthenticated=true when a user is set', () => {
    mockState = { currentUserId: 'user-1', currentTenantId: 'tenant-1' };
    const { result } = renderHook(() => useSession());
    expect(result.current.currentUserId).toBe('user-1');
    expect(result.current.currentTenantId).toBe('tenant-1');
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('returns isAuthenticated=false when userId is null even if tenantId is set', () => {
    mockState = { currentUserId: null, currentTenantId: 'tenant-1' };
    const { result } = renderHook(() => useSession());
    expect(result.current.isAuthenticated).toBe(false);
  });
});
