/**
 * useEffectivePermissions — returns the resolved permission map for the
 * current authenticated user.
 *
 * Stage-2: the daemon resolves the user's role graph (parents, denies,
 * RBAC policies) before returning `/auth/me`, so the resolved set is
 * already authoritative. We surface it here as a `Map<key, ResolvedPermission>`
 * to preserve the legacy consumer contract — `path` / `condition` are
 * not exposed by the daemon at the user-scope level (those live on the
 * per-role endpoint), so they remain empty here.
 *
 * The `userId` parameter is retained for backwards compatibility but is
 * ignored; the resolved set always belongs to the calling user. Use
 * `<EffectivePermissionsPanel scope="role" id={...}>` for per-role
 * inspection.
 */

import { useMemo } from 'react';
import { useCurrentUser } from '@/features/auth/use-current-user';
import type { ResolvedPermission } from '../host/role-resolver';

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns a Map<permissionKey, ResolvedPermission> for the current user.
 * The `userId` parameter is accepted for legacy callers but ignored —
 * the daemon only exposes the calling user's resolved set.
 */
export function useEffectivePermissions(_userId?: string): Map<string, ResolvedPermission> {
  void _userId;
  const me = useCurrentUser().data ?? null;

  return useMemo(() => {
    const map = new Map<string, ResolvedPermission>();
    if (!me) return map;
    for (const key of me.permissions) {
      map.set(key, { permission: key, path: [] });
    }
    return map;
  }, [me]);
}
