import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILT_IN_PERMISSIONS,
  RESERVED_PREFIXES,
  isReservedPermission,
  registerPermission,
  unregisterPermission,
  getPermissionRegistry,
} from './permissions';

// Reset side-effects between tests by unregistering any plugin perm added.
const PLUGIN_KEY = 'com.acme.foo:bar';

beforeEach(() => {
  // Clean up any test-registered plugin permissions between runs.
  unregisterPermission(PLUGIN_KEY);
  unregisterPermission('com.acme.foo:baz');
  unregisterPermission('invalid-no-colon');
});

describe('BUILT_IN_PERMISSIONS', () => {
  const keys = BUILT_IN_PERMISSIONS.map((p) => p.key);

  it('contains all service:* permissions', () => {
    expect(keys).toContain('service:read');
    expect(keys).toContain('service:write');
    expect(keys).toContain('service:delete');
    expect(keys).toContain('service:force-reload');
  });

  it('contains all route:* permissions', () => {
    expect(keys).toContain('route:read');
    expect(keys).toContain('route:write');
    expect(keys).toContain('route:delete');
    expect(keys).toContain('route:publish');
    expect(keys).toContain('route:attach-policy');
  });

  it('contains all policy:* permissions', () => {
    expect(keys).toContain('policy:read');
    expect(keys).toContain('policy:write');
    expect(keys).toContain('policy:delete');
  });

  it('contains all user:* permissions', () => {
    expect(keys).toContain('user:read');
    expect(keys).toContain('user:invite');
    expect(keys).toContain('user:disable');
    expect(keys).toContain('user:impersonate');
  });

  it('contains all role:* permissions', () => {
    expect(keys).toContain('role:read');
    expect(keys).toContain('role:write');
    expect(keys).toContain('role:delete');
  });

  it('contains all api-key:* permissions', () => {
    expect(keys).toContain('api-key:read');
    expect(keys).toContain('api-key:create');
    expect(keys).toContain('api-key:delete');
  });

  it('contains all session:* permissions', () => {
    expect(keys).toContain('session:read');
    expect(keys).toContain('session:revoke');
  });

  it('contains all plugin:* permissions', () => {
    expect(keys).toContain('plugin:install');
    expect(keys).toContain('plugin:enable');
    expect(keys).toContain('plugin:register-permission');
  });

  it('contains all tenant:* permissions', () => {
    expect(keys).toContain('tenant:switch');
    expect(keys).toContain('tenant:create');
  });

  it('contains all admin:* permissions', () => {
    expect(keys).toContain('admin:cross-tenant-read');
    expect(keys).toContain('admin:cross-tenant-write');
  });

  it('contains all audit:* permissions', () => {
    expect(keys).toContain('audit:read');
    expect(keys).toContain('audit:read-sensitive');
    expect(keys).toContain('audit:export');
    expect(keys).toContain('audit:retention:read');
    expect(keys).toContain('audit:retention:write');
  });

  it('contains all site:* permissions', () => {
    expect(keys).toContain('site:read');
    expect(keys).toContain('site:write');
    expect(keys).toContain('site:delete');
  });

  it('contains all middleware:* permissions', () => {
    expect(keys).toContain('middleware:read');
    expect(keys).toContain('middleware:write');
    expect(keys).toContain('middleware:delete');
  });

  it('contains all ai-provider:* permissions', () => {
    expect(keys).toContain('ai-provider:read');
    expect(keys).toContain('ai-provider:write');
    expect(keys).toContain('ai-provider:delete');
  });

  it('contains all ai-agent:* permissions', () => {
    expect(keys).toContain('ai-agent:read');
    expect(keys).toContain('ai-agent:write');
    expect(keys).toContain('ai-agent:delete');
    expect(keys).toContain('ai-agent:invoke');
  });

  it('contains all ai-tool:* permissions', () => {
    expect(keys).toContain('ai-tool:read');
    expect(keys).toContain('ai-tool:write');
    expect(keys).toContain('ai-tool:delete');
  });

  it('contains all ai-trace:* permissions', () => {
    expect(keys).toContain('ai-trace:read');
    expect(keys).toContain('ai-trace:read-sensitive');
  });

  it('contains all ai-rate-limit:* permissions', () => {
    expect(keys).toContain('ai-rate-limit:read');
    expect(keys).toContain('ai-rate-limit:write');
  });

  it('contains all mcp-server:* permissions', () => {
    expect(keys).toContain('mcp-server:read');
    expect(keys).toContain('mcp-server:write');
    expect(keys).toContain('mcp-server:delete');
  });

  it('contains all dashboard:* permissions', () => {
    expect(keys).toContain('dashboard:read');
    expect(keys).toContain('dashboard:write');
    expect(keys).toContain('dashboard:delete');
    expect(keys).toContain('dashboard:share');
    expect(keys).toContain('dashboard:set-default');
  });

  it('contains all 8 Plan 7 notification keys', () => {
    const expected = [
      'notification:read',
      'notification:manage-own',
      'notification-channel:read',
      'notification-channel:write',
      'notification-channel:test',
      'notification-routing:read',
      'notification-routing:write',
      'notification-log:read',
    ];
    expect(expected).toHaveLength(8);
    for (const key of expected) {
      expect(keys).toContain(key);
    }
  });

  it('contains all 18 Plan 3 / Plan 4 AI / MCP keys', () => {
    const expected = [
      'ai-provider:read',
      'ai-provider:write',
      'ai-provider:delete',
      'ai-agent:read',
      'ai-agent:write',
      'ai-agent:delete',
      'ai-agent:invoke',
      'ai-tool:read',
      'ai-tool:write',
      'ai-tool:delete',
      'ai-tool:invoke',
      'ai-trace:read',
      'ai-trace:read-sensitive',
      'ai-rate-limit:read',
      'ai-rate-limit:write',
      'mcp-server:read',
      'mcp-server:write',
      'mcp-server:delete',
    ];
    expect(expected).toHaveLength(18);
    for (const key of expected) {
      expect(keys).toContain(key);
    }
  });

  it('every entry has a non-empty description', () => {
    for (const p of BUILT_IN_PERMISSIONS) {
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it('every entry has source = built-in', () => {
    for (const p of BUILT_IN_PERMISSIONS) {
      expect(p.source).toBe('built-in');
    }
  });
});

describe('RESERVED_PREFIXES', () => {
  it('contains all expected reserved namespace prefixes', () => {
    const expected = [
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
    ];
    for (const prefix of expected) {
      expect(RESERVED_PREFIXES).toContain(prefix);
    }
  });
});

describe('isReservedPermission', () => {
  it('returns true for built-in permission keys', () => {
    expect(isReservedPermission('admin:cross-tenant-read')).toBe(true);
    expect(isReservedPermission('user:invite')).toBe(true);
    expect(isReservedPermission('audit:read')).toBe(true);
    expect(isReservedPermission('service:write')).toBe(true);
  });

  it('returns false for plugin-namespaced permission keys', () => {
    expect(isReservedPermission('com.acme.billing:invoice:read')).toBe(false);
    expect(isReservedPermission('io.github.foo:bar')).toBe(false);
  });

  it('returns false for unknown non-reserved keys', () => {
    expect(isReservedPermission('custom:thing')).toBe(false);
  });
});

describe('registerPermission', () => {
  it('adds a valid plugin-namespaced permission to the registry', () => {
    registerPermission({ key: PLUGIN_KEY, description: 'x', source: 'plugin-manifest' });
    expect(getPermissionRegistry().has(PLUGIN_KEY)).toBe(true);
  });

  it('throws if the key starts with a reserved prefix', () => {
    expect(() => {
      registerPermission({ key: 'admin:evil', description: 'evil', source: 'plugin-manifest' });
    }).toThrow(/reserved prefix/i);
  });

  it('throws if the key has no colon separator', () => {
    expect(() => {
      registerPermission({
        key: 'invalid-no-colon',
        description: 'bad',
        source: 'plugin-manifest',
      });
    }).toThrow(/':'.*namespace separator/i);
  });

  it('throws if the namespace before the colon contains no dot (not reverse-DNS)', () => {
    expect(() => {
      registerPermission({ key: 'acme:thing', description: 'bad', source: 'plugin-manifest' });
    }).toThrow(/reverse-DNS/i);
  });
});

describe('unregisterPermission', () => {
  it('removes a registered plugin permission', () => {
    registerPermission({ key: PLUGIN_KEY, description: 'x', source: 'plugin-manifest' });
    expect(getPermissionRegistry().has(PLUGIN_KEY)).toBe(true);
    unregisterPermission(PLUGIN_KEY);
    expect(getPermissionRegistry().has(PLUGIN_KEY)).toBe(false);
  });

  it('no-ops silently for unknown keys', () => {
    expect(() => {
      unregisterPermission('com.nonexistent:perm');
    }).not.toThrow();
  });
});
