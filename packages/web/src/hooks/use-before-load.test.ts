/**
 * requirePermissions tests.
 *
 * useMockStore.getState() is mocked so the beforeLoad callback can run outside
 * of a React context (matching real TanStack Router usage).
 *
 * Zustand's persist middleware complicates direct module mocking, so we mock
 * the entire mock-store module to return a controllable getState().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Membership, Role } from '../api/resources/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROLE_VIEWER: Role = {
  id: 'role-viewer',
  tenant_id: 'tenant-1',
  name: 'Viewer',
  parent_ids: [],
  grants: [{ permission: 'service:read' }],
  denies: [],
  system: false,
};

const MEMBERSHIP_ACTIVE: Membership = {
  id: 'mbr-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  role_ids: ['role-viewer'],
  state: 'active',
  invited_at: '2025-01-01T00:00:00Z',
};

// ─── Mock state ───────────────────────────────────────────────────────────────

interface StoreState {
  currentUserId: string | null;
  currentTenantId: string | null;
  memberships: Record<string, Membership>;
  roles: Record<string, Role>;
}

let mockGetState: () => StoreState;

vi.mock('../api/mock-store', () => ({
  useMockStore: vi.fn(),
}));

// useMockStore.getState is the non-hook path used by requirePermissions
import { useMockStore } from '../api/mock-store';

// ─── Redirect capture ─────────────────────────────────────────────────────────

// TanStack Router's redirect() throws a Redirect object.
// Mock it so we can capture and inspect the throw.
vi.mock('@tanstack/react-router', () => ({
  redirect: (opts: unknown) => {
    const err = new Error('Redirect') as Error & { isRedirect: true; opts: unknown };
    err.isRedirect = true;
    err.opts = opts;
    return err;
  },
}));

// Import AFTER mocks
import { requirePermissions } from './use-before-load';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRedirectOpts(err: unknown): { to: string; search: Record<string, unknown> } {
  const cast = err as Error & { opts: { to: string; search: Record<string, unknown> } };
  return cast.opts;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('requirePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Wire getState on the mocked useMockStore function object
    (useMockStore as unknown as { getState: () => StoreState }).getState = () => mockGetState();
  });

  it('returns true when user has the required permission', () => {
    mockGetState = () => ({
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_ACTIVE },
      roles: { 'role-viewer': ROLE_VIEWER },
    });

    const guard = requirePermissions({ required: ['service:read'] });
    expect(guard()).toBe(true);
  });

  it('throws redirect to /access-denied when user is missing a required permission', () => {
    mockGetState = () => ({
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_ACTIVE },
      roles: { 'role-viewer': ROLE_VIEWER },
    });

    const guard = requirePermissions({ required: ['admin:cross-tenant-read'] });
    let thrown: unknown;
    try {
      guard();
    } catch (err) {
      thrown = err;
    }
    const opts = getRedirectOpts(thrown);
    expect(opts.to).toBe('/access-denied');
    expect((opts.search as { required: string[] }).required).toContain('admin:cross-tenant-read');
  });

  it('throws redirect to /login when currentUserId is null', () => {
    mockGetState = () => ({
      currentUserId: null,
      currentTenantId: 'tenant-1',
      memberships: {},
      roles: {},
    });

    const guard = requirePermissions({ required: ['service:read'] });
    let thrown: unknown;
    try {
      guard();
    } catch (err) {
      thrown = err;
    }
    const opts = getRedirectOpts(thrown);
    expect(opts.to).toBe('/login');
  });

  it('passes with requireAny=true when the user has any one required perm', () => {
    mockGetState = () => ({
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_ACTIVE },
      roles: { 'role-viewer': ROLE_VIEWER },
    });

    // user has service:read but not admin:write
    const guard = requirePermissions({
      required: ['service:read', 'admin:write'],
      requireAny: true,
    });
    expect(guard()).toBe(true);
  });

  it('fails with requireAny=false when user is missing any required perm (ALL logic)', () => {
    mockGetState = () => ({
      currentUserId: 'user-1',
      currentTenantId: 'tenant-1',
      memberships: { 'mbr-1': MEMBERSHIP_ACTIVE },
      roles: { 'role-viewer': ROLE_VIEWER },
    });

    // user has service:read but not admin:write → fails ALL logic
    const guard = requirePermissions({
      required: ['service:read', 'admin:write'],
      requireAny: false,
    });
    let thrown: unknown;
    try {
      guard();
    } catch (err) {
      thrown = err;
    }
    const opts = getRedirectOpts(thrown);
    expect(opts.to).toBe('/access-denied');
  });
});
