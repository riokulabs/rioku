/**
 * useEffectivePermissions tests.
 *
 * The hook trusts the daemon-resolved permission set on `/auth/me`. We
 * mock `useCurrentUser` and verify the Map shape that downstream
 * inspectors rely on.
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
import { useEffectivePermissions } from './use-effective-permissions';

describe('useEffectivePermissions', () => {
  it('returns populated map with one entry per permission key', () => {
    mockUser = {
      id: 'user-1',
      permissions: ['service:write', 'service:read', 'route:read'],
    };
    const { result } = renderHook(() => useEffectivePermissions());
    expect(result.current.size).toBe(3);
    expect(result.current.has('service:write')).toBe(true);
    expect(result.current.has('service:read')).toBe(true);
    expect(result.current.has('route:read')).toBe(true);
  });

  it('returns empty map when no current user', () => {
    mockUser = null;
    const { result } = renderHook(() => useEffectivePermissions());
    expect(result.current.size).toBe(0);
  });

  it('returns empty map when the resolved set is empty', () => {
    mockUser = { id: 'user-1', permissions: [] };
    const { result } = renderHook(() => useEffectivePermissions());
    expect(result.current.size).toBe(0);
  });

  it('the legacy userId argument is ignored (daemon only exposes the caller)', () => {
    mockUser = { id: 'user-1', permissions: ['service:read'] };
    const { result } = renderHook(() => useEffectivePermissions('some-other-user'));
    // Still resolves to the calling user's set; the argument is a no-op.
    expect(result.current.size).toBe(1);
    expect(result.current.has('service:read')).toBe(true);
  });

  it('emits ResolvedPermission entries with empty path (per-role detail not on /auth/me)', () => {
    mockUser = { id: 'user-1', permissions: ['service:write'] };
    const { result } = renderHook(() => useEffectivePermissions());
    const entry = result.current.get('service:write');
    expect(entry).toBeDefined();
    expect(entry?.permission).toBe('service:write');
    expect(entry?.path).toEqual([]);
  });
});
