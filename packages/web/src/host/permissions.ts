/**
 * Permission catalog for the Rioku admin.
 *
 * This module is a pure catalog — it does NOT import from `api/` or the
 * Zustand mock store. The seed function in `api/mock-seed.ts` imports from
 * here (api/ → host/ boundary, permitted after ESLint config loosening).
 *
 * Plugins register permissions via `registerPermission` / `unregisterPermission`.
 * These facades operate on the local in-memory registry; the mock-seed
 * syncs built-ins into the Zustand store at boot.
 *
 * spec §7.1, §9.6.1
 */

import type { Permission } from '../api/resources/types';

// ─── Re-export Permission type for convenience ────────────────────────────────

export type { Permission };

// ─── Reserved prefixes (spec §9.6.1 rule 3) ──────────────────────────────────

export const RESERVED_PREFIXES: readonly string[] = [
  'admin:',
  'user:',
  'role:',
  'tenant:',
  'plugin:',
  'session:',
  'api-key:',
  'service:',
  'route:',
  'policy:',
  'audit:',
] as const;

// ─── Built-in permission catalog (spec §7.1) ──────────────────────────────────

export const BUILT_IN_PERMISSIONS: Permission[] = [
  // service:*
  {
    key: 'service:read',
    description: 'View service configuration and metadata',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'service:write',
    description: 'Create and update services',
    source: 'built-in',
    default_roles: ['operator', 'admin'],
  },
  {
    key: 'service:delete',
    description: 'Delete services',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'service:force-reload',
    description: 'Force a reload of service configuration into Caddy',
    source: 'built-in',
    default_roles: ['operator', 'admin'],
  },

  // route:*
  {
    key: 'route:read',
    description: 'View route configuration',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'route:write',
    description: 'Create and update routes',
    source: 'built-in',
    default_roles: ['operator', 'admin'],
  },
  {
    key: 'route:delete',
    description: 'Delete routes',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'route:publish',
    description: 'Publish route changes to live traffic',
    source: 'built-in',
    default_roles: ['operator', 'admin'],
  },
  {
    key: 'route:attach-policy',
    description: 'Attach or detach access policies from routes',
    source: 'built-in',
    default_roles: ['operator', 'admin'],
  },

  // policy:*
  {
    key: 'policy:read',
    description: 'View access and RBAC policies',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'policy:write',
    description: 'Create and update policies',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'policy:delete',
    description: 'Delete policies',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // user:*
  {
    key: 'user:read',
    description: 'View user profiles and membership state',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'user:invite',
    description: 'Invite new users to the tenant',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'user:disable',
    description: 'Disable or re-enable user accounts',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'user:impersonate',
    description: 'Impersonate another user within the tenant (super-admin only)',
    source: 'built-in',
    default_roles: ['super-admin'],
  },

  // role:*
  {
    key: 'role:read',
    description: 'View roles and their permission grants',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'role:write',
    description: 'Create and update roles',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'role:delete',
    description: 'Delete roles',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // api-key:*
  {
    key: 'api-key:read',
    description: 'View API key metadata (not the secret)',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'api-key:create',
    description: 'Create new API keys',
    source: 'built-in',
    default_roles: ['operator', 'admin'],
  },
  {
    key: 'api-key:delete',
    description: 'Revoke and delete API keys',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // session:*
  {
    key: 'session:read',
    description: 'View active sessions',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'session:revoke',
    description: 'Revoke active sessions',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // plugin:*
  {
    key: 'plugin:install',
    description: 'Install plugins from the marketplace',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'plugin:enable',
    description: 'Enable or disable installed plugins',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'plugin:register-permission',
    description: 'Allow a plugin to register custom permissions (super-admin only)',
    source: 'built-in',
    default_roles: ['super-admin'],
  },

  // tenant:*
  {
    key: 'tenant:switch',
    description: 'Switch the active tenant context',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin', 'super-admin'],
  },
  {
    key: 'tenant:create',
    description: 'Create a new tenant (super-admin only)',
    source: 'built-in',
    default_roles: ['super-admin'],
  },

  // admin:*
  {
    key: 'admin:cross-tenant-read',
    description: 'Read data across tenant boundaries (super-admin only)',
    source: 'built-in',
    default_roles: ['super-admin'],
  },
  {
    key: 'admin:cross-tenant-write',
    description: 'Write data across tenant boundaries (super-admin only)',
    source: 'built-in',
    default_roles: ['super-admin'],
  },

  // audit:*
  {
    key: 'audit:read',
    description: 'View the audit log',
    source: 'built-in',
    default_roles: ['admin', 'super-admin'],
  },
];

// ─── In-memory permission registry ───────────────────────────────────────────

/**
 * Local registry map: permission key → Permission.
 * Seeded with BUILT_IN_PERMISSIONS at module load time.
 * Plugin calls to registerPermission / unregisterPermission update this map.
 */
const _registry = new Map<string, Permission>(
  BUILT_IN_PERMISSIONS.map((p) => [p.key, p]),
);

// ─── Guards ───────────────────────────────────────────────────────────────────

/** Returns true if the given key starts with a reserved namespace prefix. */
export function isReservedPermission(key: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Validate that a plugin-declared permission key is well-formed.
 *
 * Rules (spec §9.6.1):
 *   1. Must contain at least one ':' (namespace separator).
 *   2. Must contain at least one '.' before the first ':' (reverse-DNS namespace).
 *   3. Must NOT start with a reserved prefix.
 */
function validatePluginKey(key: string): void {
  // Check reserved prefix first — gives the clearest error message.
  if (isReservedPermission(key)) {
    throw new Error(
      `Permission key "${key}" starts with a reserved prefix. Reserved prefixes: ${RESERVED_PREFIXES.join(', ')}.`,
    );
  }

  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(
      `Invalid permission key "${key}": must contain a ':' namespace separator (e.g. "com.acme.plugin:action").`,
    );
  }

  const namespace = key.slice(0, colonIdx);
  if (!namespace.includes('.')) {
    throw new Error(
      `Invalid permission key "${key}": namespace before ':' must be a reverse-DNS identifier containing at least one '.' (e.g. "com.acme.plugin").`,
    );
  }
}

// ─── Public registry API ──────────────────────────────────────────────────────

/**
 * Register a plugin-declared permission.
 *
 * Throws if the key:
 *   - Starts with a reserved prefix
 *   - Lacks a reverse-DNS namespace (no '.' before ':')
 *   - Contains no ':' at all
 *
 * Built-in permissions cannot be overwritten via this function.
 */
export function registerPermission(p: Permission): void {
  // Built-ins bypass plugin validation (they are registered at module init).
  if (p.source === 'built-in') {
    _registry.set(p.key, p);
    return;
  }

  validatePluginKey(p.key);
  _registry.set(p.key, p);
}

/**
 * Unregister a permission by key.
 * No-ops silently if the key is not found.
 */
export function unregisterPermission(key: string): void {
  _registry.delete(key);
}

/**
 * Return the full registry snapshot.
 * Used by tests and the mock-seed to read registered permissions.
 */
export function getPermissionRegistry(): ReadonlyMap<string, Permission> {
  return _registry;
}
