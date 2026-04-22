/**
 * usePermissionTrace — resolve WHY a user has (or does not have) a specific
 * permission on a specific tenant.
 *
 * Bridge hook — lives in hooks/ so that components/ can consume it without
 * violating the components/ → api/ import boundary.
 *
 * Resolution logic:
 *   1. Find the user's membership for the given tenant.
 *   2. For each role in the membership, walk the role graph via
 *      resolveRolePermissions() from src/host/role-resolver.ts.
 *   3. Also check whether the permission appears in any role's denies[].
 *   4. Return a structured trace result.
 *
 * spec §7 / Task 1d.67
 */

import { useMemo } from 'react';
import { useMockStore } from '../api/mock-store';
import { resolveRolePermissions } from '../host/role-resolver';
import type { ResolvedPermission } from '../host/role-resolver';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PermissionTraceOutcome = 'granted' | 'denied' | 'no-source';

export interface PermissionTrace {
  outcome: PermissionTraceOutcome;

  /** Set when outcome === 'granted' */
  resolved?: ResolvedPermission;

  /** The role IDs directly assigned to the user for this tenant */
  directRoleIds: string[];

  /** Role names for display (id → name) */
  roleNames: Record<string, string>;

  /** The role ID that carries the explicit deny, when outcome === 'denied' */
  denyRoleId?: string;

  /** Error message if userId/tenantId is not found */
  error?: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePermissionTrace(
  userId: string,
  tenantId: string,
  permission: string,
): PermissionTrace {
  const memberships = useMockStore((s) => s.memberships);
  const roles = useMockStore((s) => s.roles);

  return useMemo(() => {
    // Find membership for this user+tenant
    const membership = Object.values(memberships).find(
      (m) => m.user_id === userId && m.tenant_id === tenantId,
    );

    if (!membership) {
      return {
        outcome: 'no-source',
        directRoleIds: [],
        roleNames: {},
        error: `No membership found for user "${userId}" in tenant "${tenantId}".`,
      };
    }

    const directRoleIds = membership.role_ids;

    // Build roleNames map for display
    const roleNames: Record<string, string> = {};
    for (const [id, role] of Object.entries(roles)) {
      roleNames[id] = role.name;
    }

    // Check for explicit deny in any role or its ancestors
    // We walk with resolveRolePermissions which already removes denied perms.
    // To detect denies, we also need to check them directly.
    function collectDenies(roleId: string, visited = new Set<string>()): string | undefined {
      if (visited.has(roleId)) return undefined;
      visited.add(roleId);

      const role = roles[roleId];
      if (!role) return undefined;

      if (role.denies.includes(permission)) return roleId;

      for (const parentId of role.parent_ids) {
        const found = collectDenies(parentId, visited);
        if (found) return found;
      }
      return undefined;
    }

    // Check each directly-assigned role for an explicit deny
    let denyRoleId: string | undefined;
    for (const roleId of directRoleIds) {
      denyRoleId = collectDenies(roleId);
      if (denyRoleId) break;
    }

    // Resolve effective permissions (denies are already removed by the resolver)
    const effectivePerms = resolveRolePermissions(directRoleIds, roles);
    const resolved = effectivePerms.get(permission);

    if (denyRoleId) {
      return {
        outcome: 'denied',
        directRoleIds,
        roleNames,
        denyRoleId,
      };
    }

    if (resolved) {
      return {
        outcome: 'granted',
        resolved,
        directRoleIds,
        roleNames,
      };
    }

    return {
      outcome: 'no-source',
      directRoleIds,
      roleNames,
    };
  }, [memberships, roles, userId, tenantId, permission]);
}
