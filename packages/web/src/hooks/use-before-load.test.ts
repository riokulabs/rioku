/**
 * requirePermissions tests.
 *
 * Mocks the query-client cache + the redirect helper so the guard's
 * branches can run synchronously outside of any React tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

interface FakeUser {
  id: string;
  permissions: string[];
}

let cached: FakeUser | null = null;

vi.mock('@/features/auth/use-current-user', () => ({
  fetchCurrentUser: vi.fn(() => Promise.resolve(cached)),
  currentUserQueryKey: ['current-user'],
}));

vi.mock('@/api/query-client', () => ({
  queryClient: {
    getQueryData: vi.fn(() => cached),
    fetchQuery: vi.fn(() => Promise.resolve(cached)),
  },
}));

// TanStack Router's redirect() throws a Redirect object.
// Mock so we can capture and inspect the throw.
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
    cached = null;
  });

  it('returns true when user has the required permission', async () => {
    cached = { id: 'user-1', permissions: ['service:read'] };
    const guard = requirePermissions({ required: ['service:read'] });
    await expect(guard()).resolves.toBe(true);
  });

  it('throws redirect to /access-denied when user is missing a required permission', async () => {
    cached = { id: 'user-1', permissions: ['service:read'] };
    const guard = requirePermissions({ required: ['admin:cross-tenant-read'] });
    let thrown: unknown;
    try {
      await guard();
    } catch (err) {
      thrown = err;
    }
    const opts = getRedirectOpts(thrown);
    expect(opts.to).toBe('/access-denied');
    expect((opts.search as { required: string[] }).required).toContain('admin:cross-tenant-read');
  });

  it('throws redirect to /login when no user is cached', async () => {
    cached = null;
    const guard = requirePermissions({ required: ['service:read'] });
    let thrown: unknown;
    try {
      await guard();
    } catch (err) {
      thrown = err;
    }
    const opts = getRedirectOpts(thrown);
    expect(opts.to).toBe('/login');
  });

  it('passes with requireAny=true when the user has any one required perm', async () => {
    cached = { id: 'user-1', permissions: ['service:read'] };
    const guard = requirePermissions({
      required: ['service:read', 'admin:write'],
      requireAny: true,
    });
    await expect(guard()).resolves.toBe(true);
  });

  it('fails with requireAny=false when user is missing any required perm (ALL logic)', async () => {
    cached = { id: 'user-1', permissions: ['service:read'] };
    const guard = requirePermissions({
      required: ['service:read', 'admin:write'],
      requireAny: false,
    });
    let thrown: unknown;
    try {
      await guard();
    } catch (err) {
      thrown = err;
    }
    const opts = getRedirectOpts(thrown);
    expect(opts.to).toBe('/access-denied');
  });
});
