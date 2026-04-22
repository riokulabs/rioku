/**
 * useEffectivePermissions — returns the full resolved permission map for a
 * user on the current active tenant.
 *
 * Defaults to the current user if `userId` is omitted. Returns an empty Map
 * when the target user has no active memberships on the current tenant.
 *
 * Stage-1 CEL note: `when` conditions are preserved in ResolvedPermission but
 * are NOT evaluated client-side — all entries are treated as unconditionally
 * granted. Real CEL evaluation runs daemon-side at Phase 2+.
 *
 * spec §7 / Task 1d.68
 */

import { useMemo } from 'react';
import { useMockStore } from '../api/mock-store';
import { resolveRolePermissions } from '../host/role-resolver';
import type { ResolvedPermission } from '../host/role-resolver';

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns a Map<permissionKey, ResolvedPermission> for the given user (or the
 * current authenticated user) on the current active tenant.
 */
export function useEffectivePermissions(userId?: string): Map<string, ResolvedPermission> {
  const currentUserId = useMockStore((s) => s.currentUserId);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  const memberships = useMockStore((s) => s.memberships);
  const roles = useMockStore((s) => s.roles);

  return useMemo(() => {
    const targetId = userId ?? currentUserId;
    if (!targetId) return new Map<string, ResolvedPermission>();

    const userMemberships = Object.values(memberships).filter(
      (m) => m.user_id === targetId && m.tenant_id === currentTenantId && m.state === 'active',
    );

    const roleIds = userMemberships.flatMap((m) => m.role_ids);
    return resolveRolePermissions(roleIds, roles);
  }, [userId, currentUserId, currentTenantId, memberships, roles]);
}
