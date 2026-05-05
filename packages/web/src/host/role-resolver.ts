/**
 * Role-graph resolver — multi-parent inheritance with explicit deny.
 *
 * Walks the role graph depth-first, accumulating Grant entries from all
 * ancestor roles (multi-parent union). After accumulation, applies explicit
 * deny lists — any permission in a role's `denies[]` is removed from the
 * effective set.
 *
 * `path` in ResolvedPermission carries the chain of role IDs that contributed
 * the grant, for display in PermissionPathTrace UI (spec §7).
 *
 * This module only imports from `lib/` and `api/resources` (type-only).
 * It has no side-effects at module load time.
 */

import type { Role } from '../api/resources';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A permission that has been resolved through the role graph.
 *
 * `permission`  — the permission key string
 * `condition`   — optional CEL expression preserved from the grant's `when` field
 * `path`        — the role-ID chain that contributed this grant, closest first.
 *                 e.g. `['ops', 'viewer']` means the perm was inherited via
 *                 ops → viewer (viewer had the grant; ops extended viewer).
 */
export interface ResolvedPermission {
  permission: string;
  condition?: string;
  path: string[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Recursively collect grants from a role and all its ancestors.
 * Earlier entries (closer to the user's directly-assigned role) win over
 * entries from ancestor roles — first-write-wins semantics for the grant map.
 *
 * @param roleId     - Current role being walked
 * @param allRoles   - Full roles map
 * @param path       - Role-ID chain accumulated so far (for path tracking)
 * @param visited    - Set of already-visited role IDs (cycle guard)
 * @param grants     - Accumulation map: permission key → ResolvedPermission
 */
function collectGrants(
  roleId: string,
  allRoles: Record<string, Role>,
  path: string[],
  visited: Set<string>,
  grants: Map<string, ResolvedPermission>,
): void {
  if (visited.has(roleId)) return; // cycle guard
  visited.add(roleId);

  const role = allRoles[roleId];
  if (!role) return;

  const currentPath = [...path, roleId];

  // Own grants take priority — add only if not already set (closer role wins).
  for (const grant of role.grants) {
    if (!grants.has(grant.permission)) {
      const entry: ResolvedPermission = { permission: grant.permission, path: currentPath };
      if (grant.when !== undefined) {
        entry.condition = grant.when;
      }
      grants.set(grant.permission, entry);
    }
  }

  // Recurse into parent roles.
  for (const parentId of role.parent_ids) {
    collectGrants(parentId, allRoles, currentPath, visited, grants);
  }
}

/**
 * Recursively collect all explicit denies from a role and its ancestors.
 * Returns a map: permission key → path that applied the deny.
 */
function collectDenies(
  roleId: string,
  allRoles: Record<string, Role>,
  path: string[],
  visited: Set<string>,
  denies: Map<string, string[]>,
): void {
  if (visited.has(roleId)) return;
  visited.add(roleId);

  const role = allRoles[roleId];
  if (!role) return;

  const currentPath = [...path, roleId];

  for (const perm of role.denies) {
    if (!denies.has(perm)) {
      denies.set(perm, currentPath);
    }
  }

  for (const parentId of role.parent_ids) {
    collectDenies(parentId, allRoles, currentPath, visited, denies);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the effective permission set for a user given their directly-assigned
 * role IDs and the full roles map.
 *
 * Algorithm:
 *   1. For each directly-assigned role, walk the role graph depth-first
 *      collecting grants (multi-parent union, first-write-wins).
 *   2. For each directly-assigned role, walk the graph collecting denies.
 *   3. Remove any granted permission that appears in the deny set.
 *
 * Returns a Map keyed by permission string.
 */
export function resolveRolePermissions(
  userRoleIds: string[],
  allRoles: Record<string, Role>,
): Map<string, ResolvedPermission> {
  const grants = new Map<string, ResolvedPermission>();
  const denies = new Map<string, string[]>();

  for (const roleId of userRoleIds) {
    collectGrants(roleId, allRoles, [], new Set(), grants);
  }

  for (const roleId of userRoleIds) {
    collectDenies(roleId, allRoles, [], new Set(), denies);
  }

  // Apply denies: remove any granted permission listed in the deny set.
  for (const permKey of denies.keys()) {
    grants.delete(permKey);
  }

  return grants;
}

/**
 * Detect whether a role (or any of its ancestors) has a cycle in `parent_ids`.
 *
 * Uses iterative DFS with a visited set. Returns true if a cycle is found.
 */
export function detectRoleCycle(role: Role, allRoles: Record<string, Role>): boolean {
  // Use DFS with grey/black coloring to detect back-edges.
  const grey = new Set<string>(); // currently on the DFS stack
  const black = new Set<string>(); // fully processed

  function dfs(id: string): boolean {
    if (grey.has(id)) return true; // back-edge → cycle
    if (black.has(id)) return false;

    grey.add(id);
    const current = allRoles[id];
    if (current) {
      for (const parentId of current.parent_ids) {
        if (dfs(parentId)) return true;
      }
    }
    grey.delete(id);
    black.add(id);
    return false;
  }

  // Seed with the candidate role's parents (the role itself may not be in
  // allRoles yet when it's being validated before save).
  grey.add(role.id);
  for (const parentId of role.parent_ids) {
    if (dfs(parentId)) return true;
  }
  grey.delete(role.id);

  return false;
}

/**
 * Validate a role candidate before saving.
 *
 * Checks:
 *   - Self-parent: role lists its own ID in parent_ids
 *   - Cycle: any ancestor path leads back to the candidate role
 *
 * Returns `{ ok: true }` if valid, or `{ ok: false; reason: string }` if not.
 */
export function validateRoleSave(
  candidate: Role,
  allRoles: Record<string, Role>,
): { ok: true } | { ok: false; reason: string } {
  if (candidate.parent_ids.includes(candidate.id)) {
    return { ok: false, reason: `Role "${candidate.name}" cannot list itself as a parent.` };
  }

  // Temporarily inject the candidate into the roles map for cycle detection.
  const rolesWithCandidate: Record<string, Role> = { ...allRoles, [candidate.id]: candidate };

  if (detectRoleCycle(candidate, rolesWithCandidate)) {
    return {
      ok: false,
      reason: `Role "${candidate.name}" would create a cycle in the role inheritance graph.`,
    };
  }

  return { ok: true };
}
