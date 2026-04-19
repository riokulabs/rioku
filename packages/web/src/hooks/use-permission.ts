/**
 * usePermission — returns whether the current user has a specific permission
 * on the current active tenant.
 *
 * Stage-1 CEL note: If a grant has a `when` CEL condition, this hook treats
 * it as always-true (pass-through). Real CEL evaluation runs daemon-side and
 * is only enforced at Phase 2+ when the admin hits live endpoints.
 *
 * Resolution path:
 *   currentUserId + currentTenantId → memberships (active) → roleIds →
 *   resolveRolePermissions → check presence of key in resolved map.
 *
 * Returns false if currentUserId is null (not authenticated).
 *
 * spec §7 / Task 1d.68
 */

import { useMemo } from 'react';
import { useMockStore } from '../api/mock-store';
import { resolveRolePermissions } from '../host/role-resolver';

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns true if the current user holds the given permission key on the
 * current active tenant, false otherwise.
 */
export function usePermission(key: string): boolean {
  const currentUserId = useMockStore((s) => s.currentUserId);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  const memberships = useMockStore((s) => s.memberships);
  const roles = useMockStore((s) => s.roles);

  return useMemo(() => {
    if (!currentUserId) return false;

    const userMemberships = Object.values(memberships).filter(
      (m) =>
        m.user_id === currentUserId &&
        m.tenant_id === currentTenantId &&
        m.state === 'active',
    );

    const roleIds = userMemberships.flatMap((m) => m.role_ids);
    const resolved = resolveRolePermissions(roleIds, roles);

    // Stage-1: `when` conditions are pass-through; presence in resolved map is sufficient.
    return resolved.has(key);
  }, [currentUserId, currentTenantId, memberships, roles, key]);
}
