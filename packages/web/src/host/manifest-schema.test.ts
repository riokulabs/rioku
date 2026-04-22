import { describe, it, expect } from 'vitest';
import { manifestSchema } from './manifest-schema';

// ─── Minimal valid manifest ───────────────────────────────────────────────────

interface MinimalRaw {
  name: string;
  version: string;
  displayName: string;
  author: { name: string };
  abi: { minVersion: number };
  permissions?: unknown[];
  settings?: Record<string, unknown>;
}

const MINIMAL: MinimalRaw = {
  name: 'my-plugin',
  version: '1.0.0',
  displayName: 'My Plugin',
  author: { name: 'Acme Corp' },
  abi: { minVersion: 1 },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('manifestSchema — valid', () => {
  it('parses a minimal valid manifest with defaults applied', () => {
    const result = manifestSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.permissions).toEqual([]);
    expect(result.data.zones).toEqual([]);
    expect(result.data.isolation).toBe('shared');
  });

  it('parses a fully-populated manifest with all optional fields', () => {
    const full: unknown = {
      name: 'full-plugin',
      version: '2.3.4-beta.1',
      displayName: 'Full Plugin',
      author: { name: 'ACME', url: 'https://acme.example.com' },
      parts: { daemon: './daemon.so', caddy: './caddy.so', admin: './admin.js' },
      abi: { minVersion: 1, maxVersion: 3 },
      permissions: [
        {
          key: 'com.acme.billing:invoice:read',
          description: 'Read invoices',
          default_roles: ['viewer'],
        },
      ],
      zones: ['us-east', 'eu-west'],
      isolation: 'sandbox',
      settings: { scope: 'global', embedIn: 'dashboard' },
    };
    const result = manifestSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.permissions).toHaveLength(1);
    expect(result.data.isolation).toBe('sandbox');
    expect(result.data.settings?.scope).toBe('global');
    expect(result.data.abi.maxVersion).toBe(3);
  });

  it('accepts a permission key with sub-action segment', () => {
    const result = manifestSchema.safeParse({
      ...MINIMAL,
      permissions: [{ key: 'io.github.foo:bar:baz', description: 'desc' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts SemVer version with pre-release suffix', () => {
    const result = manifestSchema.safeParse({ ...MINIMAL, version: '0.1.0-alpha.3' });
    expect(result.success).toBe(true);
  });

  it('applies settings.scope default of tenant when settings provided without scope', () => {
    const result = manifestSchema.safeParse({
      ...MINIMAL,
      settings: { embedIn: 'some-page' },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.settings?.scope).toBe('tenant');
  });
});

describe('manifestSchema — invalid name', () => {
  it('rejects name starting with a hyphen', () => {
    const result = manifestSchema.safeParse({ ...MINIMAL, name: '-bad-name' });
    expect(result.success).toBe(false);
  });

  it('rejects name ending with a hyphen', () => {
    const result = manifestSchema.safeParse({ ...MINIMAL, name: 'bad-name-' });
    expect(result.success).toBe(false);
  });

  it('rejects name with uppercase letters', () => {
    const result = manifestSchema.safeParse({ ...MINIMAL, name: 'BadPlugin' });
    expect(result.success).toBe(false);
  });

  it('rejects name with spaces', () => {
    const result = manifestSchema.safeParse({ ...MINIMAL, name: 'bad plugin' });
    expect(result.success).toBe(false);
  });

  it('rejects single-char name (requires start AND end alphanumeric — need length >= 2)', () => {
    // The regex ^[a-z0-9][a-z0-9-]*[a-z0-9]$ requires at least 2 chars
    const result = manifestSchema.safeParse({ ...MINIMAL, name: 'a' });
    expect(result.success).toBe(false);
  });
});

describe('manifestSchema — invalid version', () => {
  it('rejects version without patch segment', () => {
    const result = manifestSchema.safeParse({ ...MINIMAL, version: '1.0' });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric version', () => {
    const result = manifestSchema.safeParse({ ...MINIMAL, version: 'latest' });
    expect(result.success).toBe(false);
  });
});

describe('manifestSchema — invalid permission key format', () => {
  it('rejects permission key without reverse-DNS dot', () => {
    const result = manifestSchema.safeParse({
      ...MINIMAL,
      permissions: [{ key: 'acme:action', description: 'bad — no dot in namespace' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects permission key without colon separator', () => {
    const result = manifestSchema.safeParse({
      ...MINIMAL,
      permissions: [{ key: 'com.acme.plugin', description: 'bad — no colon' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects permission key with uppercase', () => {
    const result = manifestSchema.safeParse({
      ...MINIMAL,
      permissions: [{ key: 'com.Acme.plugin:action', description: 'bad — uppercase' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('manifestSchema — reserved-prefix keys pass schema (validator responsibility)', () => {
  // The schema regex only enforces format.
  // Reserved-prefix rejection (admin:, user:, etc.) is enforced by manifest-validator.ts.
  // These keys do NOT match the schema regex because they lack a dot before ':',
  // so they will also fail schema parsing — which is fine; the validator never sees them.
  it('reserved prefix "com.admin.x:action" passes schema (has dot — format ok)', () => {
    // A key like "com.admin.x:action" has a dot and a colon, format is valid.
    // isReservedPermission would NOT flag it (it checks for "admin:" prefix, not "com.admin").
    const result = manifestSchema.safeParse({
      ...MINIMAL,
      permissions: [{ key: 'com.admin.x:action', description: 'format ok, not reserved' }],
    });
    expect(result.success).toBe(true);
  });

  it('bare reserved prefix "admin:read" fails schema (no dot before colon)', () => {
    // "admin:read" has no dot before ':', fails the schema regex.
    const result = manifestSchema.safeParse({
      ...MINIMAL,
      permissions: [{ key: 'admin:read', description: 'reserved and format-invalid' }],
    });
    expect(result.success).toBe(false);
  });
});
