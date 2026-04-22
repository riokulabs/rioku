/**
 * useEffectivePermissions tests.
 *
 * Mocks useMockStore to avoid Zustand persistence side-effects.
 * Covers: populated map for user with roles, empty map for user without memberships,
 * explicit userId override.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Membership, Role } from '../api/resources/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROLE_VIEWER: Role = {
  id: 'role-viewer',
  tenant_id: 'tenant-1',
  name: 'Viewer',
  parent_ids: [],
  grants: [{ permission: 'service:read' }, { permission: 'route:read' }],
  denies: [],
  system: false,
};

const ROLE_ADMIN: Role = {
  id: 'role-admin',
  tenant_id: 'tenant-1',
  name: 'Admin',
  parent_ids: ['role-viewer'],
  grants: [{ permission: 'service:write' }],
  denies: [],
  system: false,
};

const MEMBERSHIP_USER1: Membership = {
  id: 'mbr-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  role_ids: ['role-admin'],
  state: 'active',
  invited_at: '2025-01-01T00:00:00Z',
};

const MEMBERSHIP_USER2: Membership = {
  id: 'mbr-2',
  tenant_id: 'tenant-1',
  user_id: 'user-2',
  role_ids: ['role-viewer'],
  state: 'active',
  invited_at: '2025-01-01T00:00:00Z',
};

// ─── Mock state ───────────────────────────────────────────────────────────────

interface SelectorState {
  currentUserId: string | null;
  currentTenantId: string | null;
  memberships: Record<string, Membership>;
  roles: Record<string, Role>;
}

let mockState: SelectorState = {
  currentUserId: null,
  currentTenantId: null,
  memberships: {},
  roles: {},
};

vi.mock('../api/mock-store', () => ({
  useMockStore: (selector: (s: SelectorState) => unknown) => selector(mockState),
}));

// Import AFTER mocks
import { useEffectivePermissions } from './use-effective-permissions';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useEffectivePermissions', () => {
  it('returns populated map for current user with roles (including inherited)', () => {
    mockState = {
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_USER1 },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => useEffectivePermissions());
    expect(result.current.size).toBe(3);
    expect(result.current.has('service:write')).toBe(true);
    expect(result.current.has('service:read')).toBe(true);
    expect(result.current.has('route:read')).toBe(true);
  });

  it('returns empty map when currentUserId is null', () => {
    mockState = {
      currentUserId: null,
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_USER1 },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => useEffectivePermissions());
    expect(result.current.size).toBe(0);
  });

  it('returns empty map for user without memberships', () => {
    mockState = {
      currentUserId: 'user-99',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_USER1 },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => useEffectivePermissions());
    expect(result.current.size).toBe(0);
  });

  it('resolves permissions for an explicit userId override', () => {
    mockState = {
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: {
        'mbr-1': MEMBERSHIP_USER1,
        'mbr-2': MEMBERSHIP_USER2,
      },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    // user-2 only has role-viewer → 2 perms, not service:write
    const { result } = renderHook(() => useEffectivePermissions('user-2'));
    expect(result.current.size).toBe(2);
    expect(result.current.has('service:read')).toBe(true);
    expect(result.current.has('route:read')).toBe(true);
    expect(result.current.has('service:write')).toBe(false);
  });

  it('preserves path info in resolved permissions', () => {
    mockState = {
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_USER1 },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => useEffectivePermissions());
    // service:write is direct on role-admin
    const serviceWrite = result.current.get('service:write');
    expect(serviceWrite).toBeDefined();
    expect(serviceWrite?.path).toContain('role-admin');
  });
});
