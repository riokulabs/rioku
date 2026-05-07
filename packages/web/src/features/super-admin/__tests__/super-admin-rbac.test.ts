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

vi.mock('@tanstack/react-router', () => ({
  redirect: (opts: unknown) => {
    const err = new Error('Redirect') as Error & { isRedirect: true; opts: unknown };
    err.isRedirect = true;
    err.opts = opts;
    return err;
  },
}));

import { queryClient } from '@/api/query-client';
import { currentUserQueryKey } from '@/features/auth/use-current-user';
import { requirePermissions } from '@/hooks/use-before-load';

interface CachedUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  roles: string[];
  permissions: string[];
  status: string;
  forcePasswordChange: boolean;
  totpEnabled: boolean;
}

function seedCurrentUser(user: CachedUser | null): void {
  queryClient.setQueryData(currentUserQueryKey, user);
}

function makeUser(permissions: string[]): CachedUser {
  return {
    id: 'user-1',
    username: 'tester',
    displayName: 'Tester',
    email: 'tester@example.com',
    roles: [],
    permissions,
    status: 'active',
    forcePasswordChange: false,
    totpEnabled: false,
  };
}

async function getRedirectOpts(
  err: unknown,
): Promise<{ to: string; search: Record<string, unknown> }> {
  const cast = err as Error & { opts: { to: string; search: Record<string, unknown> } };
  return Promise.resolve(cast.opts);
}

describe('Super-admin route guard — admin:cross-tenant-read', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('redirects a tenant-admin (no cross-tenant grant) away from /admin/tenants', async () => {
    seedCurrentUser(
      makeUser([
        'service:write',
        'route:write',
        'user:invite',
        'user:disable',
        'role:write',
      ]),
    );
    const guard = requirePermissions({ required: ['admin:cross-tenant-read'] });
    let thrown: unknown;
    try {
      await guard();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    const opts = await getRedirectOpts(thrown);
    expect(opts.to).toBe('/access-denied');
    expect((opts.search as { required: string[] }).required).toContain('admin:cross-tenant-read');
  });

  it('redirects an unauthenticated user to /login from /admin/tenants', async () => {
    seedCurrentUser(null);
    const guard = requirePermissions({ required: ['admin:cross-tenant-read'] });
    let thrown: unknown;
    try {
      await guard();
    } catch (err) {
      thrown = err;
    }
    const opts = await getRedirectOpts(thrown);
    expect(opts.to).toBe('/login');
  });

  it('admits a super-admin with admin:cross-tenant-read', async () => {
    seedCurrentUser(
      makeUser(['admin:cross-tenant-read', 'admin:cross-tenant-write']),
    );
    const guard = requirePermissions({ required: ['admin:cross-tenant-read'] });
    await expect(guard()).resolves.toBe(true);
  });
});
