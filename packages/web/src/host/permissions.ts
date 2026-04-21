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
  'tenant-auth:',
  'plugin:',
  'plugin-signer:',
  'session:',
  'api-key:',
  'service:',
  'route:',
  'policy:',
  'audit:',
  'site:',
  'middleware:',
  'ai-provider:',
  'ai-agent:',
  'ai-tool:',
  'ai-trace:',
  'ai-rate-limit:',
  'mcp-server:',
  'dashboard:',
  'notification:',
  'notification-channel:',
  'notification-routing:',
  'notification-log:',
  'network:',
  'pki:',
  'tls:',
  'metrics:',
  'logs:',
  'traces:',
  'integrations:',
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
  {
    key: 'user:update-own',
    description: 'Update own profile (name, avatar, preferences, password)',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
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

  // plugin-signer:* (Plan 6)
  {
    key: 'plugin-signer:read',
    description: 'View plugin signer allow-list entries',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'plugin-signer:write',
    description: 'Create, update, verify, or revoke plugin signers',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'plugin-signer:delete',
    description: 'Delete plugin signers (only when no plugins reference them)',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // plugin:*
  {
    key: 'plugin:read',
    description: 'View installed plugins and the marketplace catalog',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'plugin:install',
    description: 'Install plugins from the marketplace',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'plugin:uninstall',
    description: 'Uninstall plugins',
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
    key: 'tenant:read',
    description: 'View the current tenant record and settings',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'tenant:write',
    description: 'Update tenant settings (name, url mode, theme, logo)',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'tenant:switch',
    description: 'Switch the active tenant context',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin', 'super-admin'],
  },
  {
    key: 'tenant-auth:read',
    description: 'View tenant authentication policy',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'tenant-auth:write',
    description: 'Update tenant authentication policy (TOTP, password, session)',
    source: 'built-in',
    default_roles: ['admin'],
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
    default_roles: ['viewer', 'ops', 'admin', 'super-admin'],
  },
  {
    key: 'audit:read-sensitive',
    description: 'View sensitive audit fields (IP, user-agent, payload bodies) and free-text search payloads',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'audit:export',
    description: 'Export audit entries as CSV or JSONL',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },
  {
    key: 'audit:retention:read',
    description: 'View the audit retention configuration',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'audit:retention:write',
    description: 'Change the audit retention configuration',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // site:*
  {
    key: 'site:read',
    description: 'View sites',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'site:write',
    description: 'Create or modify sites',
    source: 'built-in',
    default_roles: ['operator', 'admin'],
  },
  {
    key: 'site:delete',
    description: 'Delete sites',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // middleware:*
  {
    key: 'middleware:read',
    description: 'View middlewares',
    source: 'built-in',
    default_roles: ['viewer', 'operator', 'admin'],
  },
  {
    key: 'middleware:write',
    description: 'Create or modify middlewares',
    source: 'built-in',
    default_roles: ['operator', 'admin'],
  },
  {
    key: 'middleware:delete',
    description: 'Delete middlewares',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // ai-provider:*
  {
    key: 'ai-provider:read',
    description: 'View LLM providers',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'ai-provider:write',
    description: 'Configure LLM providers',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },
  {
    key: 'ai-provider:delete',
    description: 'Remove LLM providers',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // ai-agent:*
  {
    key: 'ai-agent:read',
    description: 'View AI agents',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'ai-agent:write',
    description: 'Create or modify AI agents',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },
  {
    key: 'ai-agent:delete',
    description: 'Remove AI agents',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'ai-agent:invoke',
    description: 'Invoke AI agents',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },

  // ai-tool:*
  {
    key: 'ai-tool:read',
    description: 'View AI tools',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'ai-tool:write',
    description: 'Create or modify AI tools',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },
  {
    key: 'ai-tool:delete',
    description: 'Remove AI tools',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // ai-trace:*
  {
    key: 'ai-trace:read',
    description: 'View AI traces',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'ai-trace:read-sensitive',
    description: 'View AI trace prompt/completion content',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // ai-rate-limit:*
  {
    key: 'ai-rate-limit:read',
    description: 'View semantic rate limits',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'ai-rate-limit:write',
    description: 'Configure semantic rate limits',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },

  // mcp-server:*
  {
    key: 'mcp-server:read',
    description: 'View MCP servers',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'mcp-server:write',
    description: 'Configure MCP servers',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },
  {
    key: 'mcp-server:delete',
    description: 'Remove MCP servers',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // dashboard:*
  {
    key: 'dashboard:read',
    description: 'View dashboards',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'dashboard:write',
    description: 'Create and update dashboards and widgets',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },
  {
    key: 'dashboard:delete',
    description: 'Delete dashboards',
    source: 'built-in',
    default_roles: ['admin'],
  },
  {
    key: 'dashboard:share',
    description: 'Change dashboard scope / role sharing',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },
  {
    key: 'dashboard:set-default',
    description: 'Mark a dashboard as the tenant default',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // notification:* (Plan 7 — inbox read + own-item manage)
  {
    key: 'notification:read',
    description: 'View notifications in the inbox',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'notification:manage-own',
    description: 'Mark own notifications read/unread and archive/unarchive them',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },

  // notification-channel:* (Plan 7 — outbound channel CRUD + test)
  {
    key: 'notification-channel:read',
    description: 'View notification delivery channels and their configuration',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'notification-channel:write',
    description: 'Create, update, or delete notification delivery channels',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },
  {
    key: 'notification-channel:test',
    description: 'Send a test notification through a channel',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },

  // notification-routing:* (Plan 7 — routing rules)
  {
    key: 'notification-routing:read',
    description: 'View notification routing rules',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'notification-routing:write',
    description: 'Create, update, delete, or reorder notification routing rules',
    source: 'built-in',
    default_roles: ['ops', 'admin'],
  },

  // notification-log:* (Plan 7 — delivery log, read-only)
  {
    key: 'notification-log:read',
    description: 'View the notification delivery log',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },

  // network:* (Plan 8b — daemon network configuration)
  {
    key: 'network:read',
    description: 'View daemon network configuration',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'network:write',
    description: 'Update daemon network configuration (Caddy overrides, HTTP3, timeouts)',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // pki:* (Plan 8b.7 — Certificate Authorities and enrollments)
  {
    key: 'pki:read',
    description: 'View Certificate Authorities and enrollments',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'pki:write',
    description: 'Create CAs, trigger enrollments, revoke certificates',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // tls:* (Plan 8b.8 — TLS certificates, ACME config, cipher suites)
  {
    key: 'tls:read',
    description: 'View TLS certificates and ACME configuration',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'tls:write',
    description: 'Manage TLS certificates, ACME config, and cipher suites',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // metrics:* (Plan 8b.9 — Prometheus scrape endpoint config)
  {
    key: 'metrics:read',
    description: 'View metrics scrape config',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'metrics:write',
    description: 'Update metrics scrape config',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // logs:* (Plan 8b.9 — log levels and rotation config)
  {
    key: 'logs:read',
    description: 'View log levels and rotation config',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'logs:write',
    description: 'Update log levels and rotation config',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // traces:* (Plan 8b.9 — trace retention and sampling config)
  {
    key: 'traces:read',
    description: 'View trace retention and sampling config',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'traces:write',
    description: 'Update trace retention and sampling config',
    source: 'built-in',
    default_roles: ['admin'],
  },

  // integrations:* (Plan 8c.11 — external OAuth connectors + inbound webhooks)
  {
    key: 'integrations:read',
    description: 'View external integrations (OAuth connectors, inbound webhooks)',
    source: 'built-in',
    default_roles: ['viewer', 'ops', 'admin'],
  },
  {
    key: 'integrations:write',
    description: 'Configure external integrations',
    source: 'built-in',
    default_roles: ['admin'],
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
