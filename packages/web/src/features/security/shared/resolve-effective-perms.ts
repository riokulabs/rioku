/**
 * Effective-permissions resolver — computes the full set of permissions
 * a user or role effectively holds, with per-permission source attribution.
 *
 * Sources:
 *   - 'direct'      — permission is on a role directly assigned to the user (or
 *                     is a direct grant on the role itself when called for a role)
 *   - 'parent-role' — permission is inherited from an ancestor role in the
 *                     parent_ids chain
 *   - 'rbac-policy' — permission comes through a role that was assigned to the
 *                     user by an RbacPolicy subject binding
 *
 * Cycle detection uses a visited Set at every depth of the parent-chain walk.
 * Denies are applied at the end: any permission appearing in ANY role's denies[]
 * (reachable from the user's assigned roles) is removed from the effective set.
 *
 * All returned entries are sorted by permission key.
 */

import type { Role, Membership, RbacPolicy } from '../../../api/resources/types';

// ─── Public types ─────────────────────────────────────────────────────────────

export type GrantSourceType = 'direct' | 'parent-role' | 'rbac-policy';

export interface GrantSource {
  type: GrantSourceType;
  /** Human-readable role name (or id if name not available). */
  roleName: string;
  roleId: string;
  /** Only present when type === 'rbac-policy'. */
  policyId?: string;
  policyName?: string;
  /** Optional CEL condition preserved from the grant's `when` field. */
  condition?: string;
}

export interface ResolvedGrant {
  permission: string;
  /** All sources that contribute this permission (deduplicated by role chain). */
  sources: GrantSource[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface CollectedGrant {
  permission: string;
  source: GrantSource;
}

/**
 * Walk a role's parent chain recursively, collecting grants with source attribution.
 *
 * @param roleId        - Starting role id
 * @param allRoles      - Full roles map
 * @param directRoleId  - The top-level directly-assigned role (for source labelling)
 * @param visited       - Cycle guard
 * @param isDirect      - True only when roleId === directRoleId (first call in chain)
 * @param policyContext - Present when this role was pulled in via an RbacPolicy
 */
function collectGrantsFromRole(
  roleId: string,
  allRoles: Record<string, Role>,
  roleNames: Record<string, string>,
  visited: Set<string>,
  isDirect: boolean,
  policyContext?: { policyId: string; policyName: string },
): CollectedGrant[] {
  if (visited.has(roleId)) return [];
  visited.add(roleId);

  const role = allRoles[roleId];
  if (!role) return [];

  const results: CollectedGrant[] = [];

  const sourceType: GrantSourceType = policyContext
    ? 'rbac-policy'
    : isDirect
      ? 'direct'
      : 'parent-role';

  for (const grant of role.grants) {
    const source: GrantSource = {
      type: sourceType,
      roleName: roleNames[roleId] ?? roleId,
      roleId,
    };
    if (grant.when !== undefined) {
      source.condition = grant.when;
    }
    if (policyContext) {
      source.policyId = policyContext.policyId;
      source.policyName = policyContext.policyName;
    }
    results.push({ permission: grant.permission, source });
  }

  // Recurse into parent roles — always 'parent-role' source from here on.
  for (const parentId of role.parent_ids) {
    const inherited = collectGrantsFromRole(
      parentId,
      allRoles,
      roleNames,
      visited,
      false,
      policyContext,
    );
    results.push(...inherited);
  }

  return results;
}

/**
 * Collect the full set of denied permission keys reachable from any of the
 * provided role IDs (including their ancestor chains).
 */
function collectDeniedPerms(roleIds: string[], allRoles: Record<string, Role>): Set<string> {
  const denied = new Set<string>();

  function walk(roleId: string, visited: Set<string>): void {
    if (visited.has(roleId)) return;
    visited.add(roleId);
    const role = allRoles[roleId];
    if (!role) return;
    for (const perm of role.denies) {
      denied.add(perm);
    }
    for (const parentId of role.parent_ids) {
      walk(parentId, visited);
    }
  }

  for (const roleId of roleIds) {
    walk(roleId, new Set());
  }
  return denied;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the full effective permission set for a ROLE.
 *
 * Includes the role's own direct grants AND all inherited grants from the
 * parent chain. Explicit denies are applied. Sources are attributed accordingly.
 *
 * @param roleId   - The role to resolve
 * @param allRoles - Full roles map from the store
 */
export function resolveEffectiveRolePerms(
  roleId: string,
  allRoles: Record<string, Role>,
): ResolvedGrant[] {
  const roleNames: Record<string, string> = {};
  for (const [id, role] of Object.entries(allRoles)) {
    roleNames[id] = role.name;
  }

  const rawGrants = collectGrantsFromRole(roleId, allRoles, roleNames, new Set(), true, undefined);

  const denied = collectDeniedPerms([roleId], allRoles);

  return mergeAndSort(rawGrants, denied);
}

/**
 * Resolve the full effective permission set for a USER on a specific tenant.
 *
 * Aggregates across:
 *   1. All active memberships for the user on the given tenant.
 *   2. Any RbacPolicy bindings where `subject_id === userId` (role additions
 *      via policy — these carry a 'rbac-policy' source label).
 *
 * Explicit denies from all reachable role chains are applied at the end.
 *
 * @param userId      - Target user id
 * @param tenantId    - Tenant to scope the resolution to
 * @param allRoles    - Full roles map from the store
 * @param memberships - Full memberships map from the store
 * @param rbacPolicies - Full rbacPolicies map from the store (optional — pass
 *                       empty object `{}` if not relevant)
 */
export function resolveEffectiveUserPerms(
  userId: string,
  tenantId: string,
  allRoles: Record<string, Role>,
  memberships: Record<string, Membership>,
  rbacPolicies: Record<string, RbacPolicy>,
): ResolvedGrant[] {
  const roleNames: Record<string, string> = {};
  for (const [id, role] of Object.entries(allRoles)) {
    roleNames[id] = role.name;
  }

  // Step 1: collect role IDs from active memberships.
  const directRoleIds: string[] = [];
  for (const m of Object.values(memberships)) {
    if (m.user_id === userId && m.tenant_id === tenantId && m.state === 'active') {
      directRoleIds.push(...m.role_ids);
    }
  }

  // Step 2: collect role IDs added by RbacPolicy subject bindings.
  const policyRoles: { roleId: string; policyId: string; policyName: string }[] = [];
  for (const p of Object.values(rbacPolicies)) {
    if (p.tenant_id === tenantId && p.subject_kind === 'user' && p.subject_id === userId) {
      policyRoles.push({ roleId: p.role_id, policyId: p.id, policyName: p.name });
    }
  }

  // All role ids in scope for deny collection.
  const allReachableRoleIds = [...directRoleIds, ...policyRoles.map((p) => p.roleId)];

  const rawGrants: CollectedGrant[] = [];

  // Step 3: grants from direct membership roles.
  for (const roleId of directRoleIds) {
    const grants = collectGrantsFromRole(roleId, allRoles, roleNames, new Set(), true, undefined);
    rawGrants.push(...grants);
  }

  // Step 4: grants from rbac-policy-added roles.
  for (const { roleId, policyId, policyName } of policyRoles) {
    const grants = collectGrantsFromRole(roleId, allRoles, roleNames, new Set(), false, {
      policyId,
      policyName,
    });
    rawGrants.push(...grants);
  }

  // Step 5: collect all denied permissions across reachable role chains.
  const denied = collectDeniedPerms(allReachableRoleIds, allRoles);

  return mergeAndSort(rawGrants, denied);
}

/**
 * Merge raw grants into a deduplicated list of ResolvedGrant entries.
 * Multiple sources for the same permission are merged into one entry's
 * `sources[]` array. Denied permissions are removed. Result is sorted by key.
 */
function mergeAndSort(rawGrants: CollectedGrant[], denied: Set<string>): ResolvedGrant[] {
  const map = new Map<string, ResolvedGrant>();

  for (const { permission, source } of rawGrants) {
    // Skip denied permissions.
    if (denied.has(permission)) continue;

    const existing = map.get(permission);
    if (existing) {
      // Avoid duplicate source entries (same roleId + type combo).
      const alreadyHas = existing.sources.some(
        (s) => s.roleId === source.roleId && s.type === source.type,
      );
      if (!alreadyHas) {
        existing.sources.push(source);
      }
    } else {
      map.set(permission, { permission, sources: [source] });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.permission.localeCompare(b.permission));
}
