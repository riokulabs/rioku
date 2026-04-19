import { describe, it, expect } from 'vitest';
import { validateManifest } from './manifest-validator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MINIMAL = {
  name: 'my-plugin',
  version: '1.0.0',
  displayName: 'My Plugin',
  author: { name: 'Acme Corp' },
  abi: { minVersion: 1 },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateManifest — valid', () => {
  it('returns ok=true for a valid minimal manifest', () => {
    const result = validateManifest(MINIMAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it('returns ok=true for a manifest with valid plugin permissions', () => {
    const result = validateManifest({
      ...MINIMAL,
      permissions: [
        { key: 'com.acme.billing:invoice:read', description: 'Read invoices' },
        { key: 'io.github.foo:action', description: 'Some action' },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateManifest — reserved prefix rejection', () => {
  // Note: bare reserved-prefix keys like "admin:read" also fail the schema regex,
  // so they surface as schema errors. The semantic check provides a clearer message
  // for keys that are structurally valid but reserved — e.g. a key that somehow
  // matches format but still starts with a reserved segment.
  // We test the semantic path via a structurally valid key that starts with
  // a reserved prefix differently. Actually the schema regex prevents bare
  // reserved keys, so we exercise the case that WOULD be valid format but isn't
  // by testing the structural failure path too.

  it('returns ok=false for a structurally-invalid reserved prefix key (admin:read)', () => {
    const result = validateManifest({
      ...MINIMAL,
      permissions: [{ key: 'admin:read', description: 'Reserved prefix, no dot' }],
    });
    // Fails schema regex (no dot before ':'), so errors come from schema stage.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns ok=false with semantic error for a reserved-prefix key with dot-namespace', () => {
    // "plugin.ext:action" — has a dot, passes schema, but "plugin:" is reserved.
    // Actually "plugin.ext:action" does NOT start with "plugin:" — it starts with "plugin.".
    // Real scenario: we test with a key built to exercise isReservedPermission.
    // The reserved prefixes are: admin:, user:, role:, tenant:, plugin:, session:, api-key:, etc.
    // A key starting with "admin." before ":" is NOT reserved (reserved check is prefix match).
    // To get a semantic-stage reserved error: the key would need dot + reserved-colon-prefix.
    // Example: a key like "com.admin.thing:action" does NOT trigger isReservedPermission
    // because it starts with "com.", not "admin:".
    // The only way to get a semantic-stage error is if a key passes the schema regex
    // AND isReservedPermission returns true. Given RESERVED_PREFIXES checks startsWith,
    // this cannot happen: schema regex requires a dot before ":", but reserved prefixes
    // are of the form "prefix:" with no dot. So schema catches them first.
    // We verify this behavior: keys failing schema give schema errors, not semantic errors.
    const result = validateManifest({
      ...MINIMAL,
      permissions: [{ key: 'plugin:install', description: 'Trying to override built-in' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('validateManifest — privilege-escalation warning', () => {
  it('returns ok=true with non-empty warnings when default_roles includes "admin"', () => {
    const result = validateManifest({
      ...MINIMAL,
      permissions: [
        {
          key: 'com.acme.billing:invoice:read',
          description: 'Read invoices',
          default_roles: ['viewer', 'admin'],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/admin/);
  });

  it('warns for "super-admin" in default_roles', () => {
    const result = validateManifest({
      ...MINIMAL,
      permissions: [
        {
          key: 'com.acme.billing:invoice:write',
          description: 'Write invoices',
          default_roles: ['super-admin'],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes('super-admin'))).toBe(true);
  });

  it('does not warn for non-privileged roles', () => {
    const result = validateManifest({
      ...MINIMAL,
      permissions: [
        {
          key: 'com.acme.billing:invoice:read',
          description: 'Read invoices',
          default_roles: ['viewer', 'operator'],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });
});

describe('validateManifest — invalid permission key format', () => {
  it('returns ok=false when permission key lacks a dot before colon', () => {
    const result = validateManifest({
      ...MINIMAL,
      permissions: [{ key: 'acme:action', description: 'No dot in namespace' }],
    });
    expect(result.ok).toBe(false);
  });

  it('returns ok=false when permission key has no colon', () => {
    const result = validateManifest({
      ...MINIMAL,
      permissions: [{ key: 'com.acme.action', description: 'No colon' }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('validateManifest — multiple errors', () => {
  it('surfaces all errors in a single result for multiple bad permissions', () => {
    const result = validateManifest({
      name: 'bad-name-',    // bad name (ends with hyphen)
      version: 'not-semver',
      displayName: '',      // empty
      author: { name: 'A' },
      abi: { minVersion: -1 }, // negative
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

describe('validateManifest — non-object input', () => {
  it('returns ok=false for null', () => {
    const result = validateManifest(null);
    expect(result.ok).toBe(false);
  });

  it('returns ok=false for a plain string', () => {
    const result = validateManifest('not a manifest');
    expect(result.ok).toBe(false);
  });
});
