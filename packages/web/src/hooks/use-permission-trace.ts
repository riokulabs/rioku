/**
 * usePermissionTrace — best-effort trace of WHY a user has (or does
 * not have) a specific permission on a specific tenant.
 *
 * Stage-2: backed by the daemon's flat per-tenant role API. The
 * authoritative role-graph walk (parents, denies, CEL) lives on the
 * daemon; the SPA does not have a dedicated trace endpoint, so this
 * hook reports the directly-assigned roles plus which (if any) of them
 * carries the permission in its flat permission list.
 *
 * Outcomes:
 *   - granted   — at least one assigned role lists the permission.
 *   - no-source — none of the assigned roles list it; the user lacks it.
 *   - denied    — not derivable from the daemon's flat role payload;
 *                 deny entries are resolved server-side and only
 *                 surface as "no-source" client-side. Surfaced for
 *                 backwards compatibility but never produced.
 */

import { useMemo } from 'react';
import { useListUserRoles, useListRoles } from '@/api/generated/roles/roles';
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
  /** The role ID that carries the explicit deny, when outcome === 'denied'. */
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
  const userRolesQuery = useListUserRoles(tenantId, userId, {
    query: { enabled: tenantId !== '' && userId !== '' },
  });
  const allRolesQuery = useListRoles(tenantId, {
    query: { enabled: tenantId !== '' },
  });

  return useMemo(() => {
    const userRoles: { id?: string; name?: string }[] = userRolesQuery.data?.data.roles ?? [];
    const allRoles: { id?: string; name?: string; permissions?: string[] }[] =
      allRolesQuery.data?.data.roles ?? [];

    if (userRoles.length === 0 && !userRolesQuery.isLoading) {
      return {
        outcome: 'no-source' as const,
        directRoleIds: [],
        roleNames: {},
        error: `No role assignments found for user "${userId}" in tenant "${tenantId}".`,
      };
    }

    const directRoleIds = userRoles
      .map((r) => r.id)
      .filter((id): id is string => typeof id === 'string');

    const roleNames: Record<string, string> = {};
    for (const r of allRoles) {
      if (r.id) roleNames[r.id] = r.name ?? r.id;
    }
    for (const r of userRoles) {
      if (r.id && !roleNames[r.id]) roleNames[r.id] = r.name ?? r.id;
    }

    // Find the first directly-assigned role whose flat permission list
    // contains the requested key. This is best-effort — the daemon has
    // already applied parent inheritance and deny rules before returning.
    const grantingRole = allRoles.find(
      (r) => r.id && directRoleIds.includes(r.id) && (r.permissions ?? []).includes(permission),
    );

    if (grantingRole?.id) {
      return {
        outcome: 'granted' as const,
        resolved: { permission, path: [grantingRole.id] },
        directRoleIds,
        roleNames,
      };
    }

    return {
      outcome: 'no-source' as const,
      directRoleIds,
      roleNames,
    };
  }, [
    userRolesQuery.data,
    userRolesQuery.isLoading,
    allRolesQuery.data,
    userId,
    tenantId,
    permission,
  ]);
}
