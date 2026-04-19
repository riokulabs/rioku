/**
 * usePermission tests.
 *
 * Mocks useMockStore to avoid Zustand persistence side-effects.
 * Covers: perm present, perm absent, no current user, no memberships.
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

const MEMBERSHIP_ACTIVE: Membership = {
  id: 'mbr-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  role_ids: ['role-admin'],
  state: 'active',
  invited_at: '2025-01-01T00:00:00Z',
};

const MEMBERSHIP_DEACTIVATED: Membership = {
  id: 'mbr-2',
  tenant_id: 'tenant-1',
  user_id: 'user-2',
  role_ids: ['role-admin'],
  state: 'deactivated',
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
import { usePermission } from './use-permission';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('usePermission', () => {
  it('returns false when currentUserId is null', () => {
    mockState = {
      currentUserId: null,
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_ACTIVE },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => usePermission('service:read'));
    expect(result.current).toBe(false);
  });

  it('returns true when user has the permission via direct role', () => {
    mockState = {
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_ACTIVE },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => usePermission('service:write'));
    expect(result.current).toBe(true);
  });

  it('returns true when user has the permission via inherited parent role', () => {
    mockState = {
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_ACTIVE },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    // role-admin inherits from role-viewer which has service:read
    const { result } = renderHook(() => usePermission('service:read'));
    expect(result.current).toBe(true);
  });

  it('returns false when user does not have the permission', () => {
    mockState = {
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_ACTIVE },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => usePermission('admin:cross-tenant-read'));
    expect(result.current).toBe(false);
  });

  it('returns false when the user membership is deactivated', () => {
    mockState = {
      currentUserId: 'user-2',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-2': MEMBERSHIP_DEACTIVATED },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => usePermission('service:write'));
    expect(result.current).toBe(false);
  });

  it('returns false when user has no memberships', () => {
    mockState = {
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: {},
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => usePermission('service:read'));
    expect(result.current).toBe(false);
  });

  it('returns false when currentTenantId is null', () => {
    mockState = {
      currentUserId: 'user-1',
      currentTenantId: null,
      memberships: { 'mbr-1': MEMBERSHIP_ACTIVE },
      roles: { 'role-viewer': ROLE_VIEWER, 'role-admin': ROLE_ADMIN },
    };
    const { result } = renderHook(() => usePermission('service:read'));
    expect(result.current).toBe(false);
  });
});
