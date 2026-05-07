/**
 * Super-admin RBAC negative tests — Plan 11 close-out.
 *
 * Asserts that the `/admin/*` route guard (which the route wires to
 * `requirePermissions({ required: ['admin:cross-tenant-read'] })`) refuses
 * non-super-admin actors and redirects them to /access-denied. This complements
 * the daemon-side TestAdminTenants_Forbidden_NonSuperAdmin Go test in
 * packages/daemon/internal/gateway/tenant_routes_test.go.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Membership, Role } from '@/api/resources';

const TENANT_ADMIN_ROLE: Role = {
  id: 'role-tenant-admin',
  tenant_id: 'tenant-acme',
  name: 'Tenant Admin',
  parent_ids: [],
  // Tenant-level admin powers — but no cross-tenant grant.
  grants: [
    { permission: 'service:write' },
    { permission: 'route:write' },
    { permission: 'user:invite' },
    { permission: 'user:disable' },
    { permission: 'role:write' },
  ],
  denies: [],
  system: false,
};

const SUPER_ADMIN_ROLE: Role = {
  id: 'role-super-admin',
  tenant_id: 'tenant-root',
  name: 'Super Admin',
  parent_ids: [],
  grants: [
    { permission: 'admin:cross-tenant-read' },
    { permission: 'admin:cross-tenant-write' },
  ],
  denies: [],
  system: true,
};

const TENANT_ADMIN_MEMBERSHIP: Membership = {
  id: 'mbr-tenant-admin',
  tenant_id: 'tenant-acme',
  user_id: 'user-tenant-admin',
  role_ids: ['role-tenant-admin'],
  state: 'active',
  invited_at: '2026-01-01T00:00:00Z',
};

const SUPER_ADMIN_MEMBERSHIP: Membership = {
  id: 'mbr-super-admin',
  tenant_id: 'tenant-root',
  user_id: 'user-super-admin',
  role_ids: ['role-super-admin'],
  state: 'active',
  invited_at: '2026-01-01T00:00:00Z',
};

interface StoreState {
  currentUserId: string | null;
  currentTenantId: string | null;
  memberships: Record<string, Membership>;
  roles: Record<string, Role>;
}

let mockGetState: () => StoreState;

vi.mock('@/api/mock-store', () => ({
  useMockStore: vi.fn(),
}));

import { useMockStore } from '@/api/mock-store';

vi.mock('@tanstack/react-router', () => ({
  redirect: (opts: unknown) => {
    const err = new Error('Redirect') as Error & { isRedirect: true; opts: unknown };
    err.isRedirect = true;
    err.opts = opts;
    return err;
  },
}));

import { requirePermissions } from '@/hooks/use-before-load';

function getRedirectOpts(err: unknown): { to: string; search: Record<string, unknown> } {
  const cast = err as Error & { opts: { to: string; search: Record<string, unknown> } };
  return cast.opts;
}

describe('Super-admin route guard — admin:cross-tenant-read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useMockStore as unknown as { getState: () => StoreState }).getState = () => mockGetState();
  });

  it('redirects a tenant-admin (no cross-tenant grant) away from /admin/tenants', () => {
    mockGetState = () => ({
      currentUserId: 'user-tenant-admin',
      currentTenantId: 'tenant-acme',
      memberships: { [TENANT_ADMIN_MEMBERSHIP.id]: TENANT_ADMIN_MEMBERSHIP },
      roles: { [TENANT_ADMIN_ROLE.id]: TENANT_ADMIN_ROLE },
    });
    const guard = requirePermissions({ required: ['admin:cross-tenant-read'] });
    let thrown: unknown;
    try {
      guard();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    const opts = getRedirectOpts(thrown);
    expect(opts.to).toBe('/access-denied');
    expect((opts.search as { required: string[] }).required).toContain('admin:cross-tenant-read');
  });

  it('redirects an unauthenticated user to /login from /admin/tenants', () => {
    mockGetState = () => ({
      currentUserId: null,
      currentTenantId: null,
      memberships: {},
      roles: {},
    });
    const guard = requirePermissions({ required: ['admin:cross-tenant-read'] });
    let thrown: unknown;
    try {
      guard();
    } catch (err) {
      thrown = err;
    }
    expect(getRedirectOpts(thrown).to).toBe('/login');
  });

  it('admits a super-admin with admin:cross-tenant-read', () => {
    mockGetState = () => ({
      currentUserId: 'user-super-admin',
      currentTenantId: 'tenant-root',
      memberships: { [SUPER_ADMIN_MEMBERSHIP.id]: SUPER_ADMIN_MEMBERSHIP },
      roles: { [SUPER_ADMIN_ROLE.id]: SUPER_ADMIN_ROLE },
    });
    const guard = requirePermissions({ required: ['admin:cross-tenant-read'] });
    expect(guard()).toBe(true);
  });
});
