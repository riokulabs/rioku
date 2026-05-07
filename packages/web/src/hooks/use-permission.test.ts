/**
 * usePermission tests.
 *
 * Mocks `useCurrentUser` so we can drive the resolved-permissions array
 * directly without standing up an HTTP server. The daemon resolves role
 * graph + denies before returning, so the hook itself is just a membership
 * check.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

interface FakeUser {
  id: string;
  permissions: string[];
}

let mockUser: FakeUser | null = null;

vi.mock('@/features/auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: mockUser }),
}));

// Import AFTER mocks
import { usePermission } from './use-permission';

describe('usePermission', () => {
  it('returns false when no current user', () => {
    mockUser = null;
    const { result } = renderHook(() => usePermission('service:read'));
    expect(result.current).toBe(false);
  });

  it('returns true when permission is in the resolved set', () => {
    mockUser = { id: 'user-1', permissions: ['service:read', 'service:write'] };
    const { result } = renderHook(() => usePermission('service:write'));
    expect(result.current).toBe(true);
  });

  it('returns false when permission is not in the resolved set', () => {
    mockUser = { id: 'user-1', permissions: ['service:read'] };
    const { result } = renderHook(() => usePermission('admin:cross-tenant-read'));
    expect(result.current).toBe(false);
  });

  it('returns false when the resolved set is empty', () => {
    mockUser = { id: 'user-1', permissions: [] };
    const { result } = renderHook(() => usePermission('service:read'));
    expect(result.current).toBe(false);
  });
});
