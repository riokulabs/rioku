/**
 * usePermissionsCatalog — bridge hook for permission catalog data.
 *
 * Reads the permissions map from the Zustand mock store and returns a
 * stable, grouped structure for use by <PermissionSelector> and similar
 * components. Lives in hooks/ so that the components/ boundary is not
 * violated (components/ must not import from api/).
 *
 * Grouping strategy:
 *   - Built-in permissions are grouped under "Built-in" with the namespace
 *     prefix (e.g. "service", "route") as the sub-group key.
 *   - Plugin permissions (plugin-manifest, plugin-dynamic) are grouped under
 *     their reverse-DNS namespace (the part before the first ':').
 *
 * spec §7.1 / Task 1d.66
 */

import { useMockStore } from '../api/mock-store';
import type { Permission } from '../api/resources';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PermissionGroup {
  /** Display label for the group (e.g. "Built-in" or "com.acme.billing") */
  label: string;
  permissions: Permission[];
}

export interface PermissionsCatalog {
  /** All permissions flat, for quick lookup */
  all: Permission[];
  /** Permissions grouped for display */
  groups: PermissionGroup[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePermissionsCatalog(): PermissionsCatalog {
  const permissions = useMockStore((s) => s.permissions);

  const all = Object.values(permissions);

  // Separate built-ins from plugin permissions
  const builtIns = all.filter((p) => p.source === 'built-in');
  const pluginPerms = all.filter((p) => p.source !== 'built-in');

  // Group built-ins by namespace prefix (before ':')
  const builtInGroup: PermissionGroup = {
    label: 'Built-in',
    permissions: builtIns,
  };

  // Group plugin permissions by reverse-DNS namespace
  const pluginGroupMap = new Map<string, Permission[]>();
  for (const p of pluginPerms) {
    const colonIdx = p.key.indexOf(':');
    const ns = colonIdx !== -1 ? p.key.slice(0, colonIdx) : p.key;
    const existing = pluginGroupMap.get(ns) ?? [];
    existing.push(p);
    pluginGroupMap.set(ns, existing);
  }

  // Prefix plugin namespace groups with "Plugin: " so the UI clearly identifies
  // dynamically-contributed permission sections (spec §9.6.1 / Task 1f.109).
  const pluginGroups: PermissionGroup[] = Array.from(pluginGroupMap.entries()).map(
    ([ns, perms]) => ({ label: `Plugin: ${ns}`, permissions: perms }),
  );

  const groups: PermissionGroup[] =
    builtIns.length > 0 ? [builtInGroup, ...pluginGroups] : pluginGroups;

  return { all, groups };
}
