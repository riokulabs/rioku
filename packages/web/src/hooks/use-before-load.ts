/**
 * Route-level permission guard helper.
 *
 * `requirePermissions` returns a TanStack Router `beforeLoad` function.
 * `beforeLoad` runs OUTSIDE the React hook tree, so we read from the
 * shared QueryClient cache — by the time any tenant route mounts, the
 * `/auth/me` query has already been kicked off (auth router resolves
 * it before children render).
 *
 * Stage-2: the daemon resolves the role graph + denies + CEL conditions
 * before populating `permissions` on `/auth/me`, so this guard is a
 * straightforward set-membership check.
 *
 * Redirect behaviour:
 *   - No current user → redirect to `/login` with the original URL in
 *     the `return` search param.
 *   - Missing required perms → redirect to `/access-denied`.
 */

import { redirect } from '@tanstack/react-router';
import { fetchCurrentUser, currentUserQueryKey } from '@/features/auth/use-current-user';
import { queryClient } from '@/api/query-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RequirePermissionsOptions {
  /** Permission keys the user must hold. By default ALL are required. */
  required: string[];
  /** If true, the user needs any one of the required keys (OR logic). */
  requireAny?: boolean;
}

// ─── Guard factory ────────────────────────────────────────────────────────────

/**
 * Returns a TanStack Router `beforeLoad` callback that enforces permission
 * requirements before allowing navigation.
 *
 * Usage (in a route file):
 * ```ts
 * export const Route = createFileRoute('/admin')({
 *   beforeLoad: requirePermissions({ required: ['admin:cross-tenant-read'] }),
 *   component: ...,
 * });
 * ```
 */
export function requirePermissions(opts: RequirePermissionsOptions) {
  return async (): Promise<true> => {
    // Try cache first; fall through to a fetch when the auth root has not
    // primed the query yet (e.g. cold deep-link into a guarded route).
    const me =
      queryClient.getQueryData<Awaited<ReturnType<typeof fetchCurrentUser>>>(currentUserQueryKey) ??
      (await queryClient.fetchQuery({
        queryKey: currentUserQueryKey,
        queryFn: ({ signal }) => fetchCurrentUser(signal),
      }));

    if (!me) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: '/login' as string,
        search: {
          return:
            typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/',
        } as Record<string, unknown>,
      });
    }

    // Wildcard '*' is the daemon-side representation for superadmin/root
    // ("full access"). Without this branch the gate fails for root on every
    // tenant-scoped route — guarded pages render the /access-denied screen
    // even though the user has unrestricted permissions on the backend.
    const isWildcard = me.permissions.includes('*');
    const has = (k: string): boolean => isWildcard || me.permissions.includes(k);
    const pass = opts.requireAny ? opts.required.some(has) : opts.required.every(has);

    if (!pass) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: '/access-denied' as string,
        search: {
          required: opts.required,
          requireAny: opts.requireAny ?? false,
        } as Record<string, unknown>,
      });
    }

    return true;
  };
}
