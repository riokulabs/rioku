/**
 * usePermissionsCatalog — bridge hook for the permission catalog.
 *
 * Stage-2: backed by the daemon's `GET /api/v1/t/{tenant}/permissions`
 * endpoint via the Orval-generated `useListPermissions` hook. We adapt
 * the wire shape (id, source, sourcePluginId) into the local
 * `Permission` type used by `<PermissionSelector>` and friends.
 *
 * Grouping strategy:
 *   - Built-in permissions are grouped under "Built-in".
 *   - Plugin permissions (plugin-manifest, plugin-dynamic) are grouped
 *     under their reverse-DNS namespace (the part before the first ':').
 */

import { useListPermissions } from '@/api/generated/permissions/permissions';
import type { Permission as GenPermission } from '@/api/generated/schemas';
import type { Permission } from '../api/resources';
import { useActiveTenantSlug } from './use-tenant';

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

// ─── Adapter ──────────────────────────────────────────────────────────────────

function adapt(p: GenPermission): Permission {
  return {
    key: p.id ?? '',
    description: p.description ?? '',
    source: p.source ?? 'built-in',
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePermissionsCatalog(): PermissionsCatalog {
  const tenant = useActiveTenantSlug() ?? '';
  const query = useListPermissions(tenant, undefined, {
    query: { enabled: tenant !== '' },
  });
  const raw: GenPermission[] = query.data?.data.permissions ?? [];
  const all: Permission[] = raw
    .filter((p) => typeof p.id === 'string' && p.id.length > 0)
    .map(adapt);

  // Separate built-ins from plugin permissions
  const builtIns = all.filter((p) => p.source === 'built-in');
  const pluginPerms = all.filter((p) => p.source !== 'built-in');

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

  const pluginGroups: PermissionGroup[] = Array.from(pluginGroupMap.entries()).map(
    ([ns, perms]) => ({ label: `Plugin: ${ns}`, permissions: perms }),
  );

  const groups: PermissionGroup[] =
    builtIns.length > 0 ? [builtInGroup, ...pluginGroups] : pluginGroups;

  return { all, groups };
}
