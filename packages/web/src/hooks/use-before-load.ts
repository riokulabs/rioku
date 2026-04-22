/**
 * Route-level permission guard helper.
 *
 * `requirePermissions` returns a TanStack Router `beforeLoad` function.
 * It runs OUTSIDE the React hook call tree (beforeLoad is not a hook context),
 * so mock-store state is accessed via `useMockStore.getState()` directly.
 *
 * Redirect behaviour:
 *   - No current user  → redirect to /login (with return URL in search)
 *   - Missing required perms → redirect to /access-denied (with required + requireAny)
 *
 * Stage-1 CEL note: `when` conditions on grants are treated as always-true.
 * Real CEL evaluation runs daemon-side at Phase 2+.
 */

import { redirect } from '@tanstack/react-router';
import { useMockStore } from '../api/mock-store';
import { resolveRolePermissions } from '../host/role-resolver';

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
  return (): true => {
    const { currentUserId, currentTenantId, memberships, roles } = useMockStore.getState();

    if (!currentUserId) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: '/login' as string,
        search: {
          return:
            typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/',
        } as Record<string, unknown>,
      });
    }

    // Derive the user's active role IDs for the current tenant
    const userMemberships = Object.values(memberships).filter(
      (m) => m.user_id === currentUserId && m.tenant_id === currentTenantId && m.state === 'active',
    );
    const roleIds = userMemberships.flatMap((m) => m.role_ids);
    const resolved = resolveRolePermissions(roleIds, roles);

    const has = (k: string): boolean => resolved.has(k);
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
