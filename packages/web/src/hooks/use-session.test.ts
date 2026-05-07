/**
 * useSession tests.
 *
 * Mocks the daemon-backed `useCurrentUser` and the route-derived
 * `useActiveTenantSlug` so we can exercise auth/tenant combinations
 * without spinning up MSW.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

interface FakeUser {
  id: string;
}

let mockUser: FakeUser | null = null;
let mockTenantSlug: string | null = null;

vi.mock('@/features/auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: mockUser }),
}));

vi.mock('./use-tenant', () => ({
  useActiveTenantSlug: () => mockTenantSlug,
}));

// Import AFTER mocks
import { useSession } from './use-session';

describe('useSession', () => {
  it('returns nulls and isAuthenticated=false when no user is set', () => {
    mockUser = null;
    mockTenantSlug = null;
    const { result } = renderHook(() => useSession());
    expect(result.current.currentUserId).toBeNull();
    expect(result.current.currentTenantId).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('returns currentUserId and isAuthenticated=true when a user is set', () => {
    mockUser = { id: 'user-1' };
    mockTenantSlug = 'acme';
    const { result } = renderHook(() => useSession());
    expect(result.current.currentUserId).toBe('user-1');
    expect(result.current.currentTenantId).toBe('acme');
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('returns isAuthenticated=false when user is null even if tenant slug is set', () => {
    mockUser = null;
    mockTenantSlug = 'acme';
    const { result } = renderHook(() => useSession());
    expect(result.current.isAuthenticated).toBe(false);
  });
});
