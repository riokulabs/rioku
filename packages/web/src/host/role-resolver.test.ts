import { describe, it, expect } from 'vitest';
import {
  resolveRolePermissions,
  detectRoleCycle,
  validateRoleSave,
} from './role-resolver';
import type { Role } from '../api/resources/types';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeRole(overrides: Partial<Role> & { id: string }): Role {
  return {
    tenant_id: 'tenant-1',
    name: overrides.id,
    parent_ids: [],
    grants: [],
    denies: [],
    system: false,
    ...overrides,
  };
}

// ─── resolveRolePermissions ───────────────────────────────────────────────────

describe('resolveRolePermissions', () => {
  it('flat grants: returns all grants for a single role', () => {
    const viewer = makeRole({
      id: 'viewer',
      grants: [
        { permission: 'service:read' },
        { permission: 'route:read' },
      ],
    });
    const allRoles = { viewer };

    const result = resolveRolePermissions(['viewer'], allRoles);

    expect(result.size).toBe(2);
    expect(result.has('service:read')).toBe(true);
    expect(result.has('route:read')).toBe(true);
  });

  it('flat grants: resolved entries carry correct path', () => {
    const viewer = makeRole({
      id: 'viewer',
      grants: [{ permission: 'service:read' }],
    });

    const result = resolveRolePermissions(['viewer'], { viewer });

    expect(result.get('service:read')?.path).toEqual(['viewer']);
  });

  it('single-parent inheritance: ops extends viewer, ops gets viewer perms + own', () => {
    const viewer = makeRole({
      id: 'viewer',
      grants: [{ permission: 'service:read' }, { permission: 'route:read' }],
    });
    const ops = makeRole({
      id: 'ops',
      parent_ids: ['viewer'],
      grants: [{ permission: 'service:write' }],
    });
    const allRoles = { viewer, ops };

    const result = resolveRolePermissions(['ops'], allRoles);

    expect(result.has('service:read')).toBe(true);
    expect(result.has('route:read')).toBe(true);
    expect(result.has('service:write')).toBe(true);
  });

  it('single-parent inheritance: inherited perm path includes both roles', () => {
    const viewer = makeRole({
      id: 'viewer',
      grants: [{ permission: 'service:read' }],
    });
    const ops = makeRole({
      id: 'ops',
      parent_ids: ['viewer'],
      grants: [],
    });
    const allRoles = { viewer, ops };

    const result = resolveRolePermissions(['ops'], allRoles);

    // path should show ops (the walking start), then viewer (where grant came from)
    expect(result.get('service:read')?.path).toEqual(['ops', 'viewer']);
  });

  it('multi-parent union: admin extends ops and billing-admin, gets union of both', () => {
    const viewer = makeRole({
      id: 'viewer',
      grants: [{ permission: 'service:read' }],
    });
    const ops = makeRole({
      id: 'ops',
      parent_ids: ['viewer'],
      grants: [{ permission: 'service:write' }],
    });
    const billing = makeRole({
      id: 'billing-admin',
      grants: [{ permission: 'api-key:create' }, { permission: 'api-key:read' }],
    });
    const admin = makeRole({
      id: 'admin',
      parent_ids: ['ops', 'billing-admin'],
      grants: [{ permission: 'role:write' }],
    });
    const allRoles = { viewer, ops, billing, 'billing-admin': billing, admin };

    const result = resolveRolePermissions(['admin'], allRoles);

    expect(result.has('service:read')).toBe(true); // from viewer via ops
    expect(result.has('service:write')).toBe(true); // from ops
    expect(result.has('api-key:create')).toBe(true); // from billing-admin
    expect(result.has('api-key:read')).toBe(true); // from billing-admin
    expect(result.has('role:write')).toBe(true); // own grant
  });

  it('conditional grant: condition is preserved in resolved entry', () => {
    const role = makeRole({
      id: 'ops',
      grants: [{ permission: 'service:read', when: 'resource.tenant == user.tenant' }],
    });

    const result = resolveRolePermissions(['ops'], { ops: role });

    expect(result.get('service:read')?.condition).toBe('resource.tenant == user.tenant');
  });

  it('explicit deny: contractor extends viewer but denies audit:read', () => {
    const viewer = makeRole({
      id: 'viewer',
      grants: [
        { permission: 'service:read' },
        { permission: 'audit:read' },
      ],
    });
    const contractor = makeRole({
      id: 'contractor',
      parent_ids: ['viewer'],
      grants: [],
      denies: ['audit:read'],
    });
    const allRoles = { viewer, contractor };

    const result = resolveRolePermissions(['contractor'], allRoles);

    expect(result.has('service:read')).toBe(true); // inherited, not denied
    expect(result.has('audit:read')).toBe(false); // denied explicitly
  });

  it('explicit deny: denied permission is removed even if granted by own role', () => {
    const role = makeRole({
      id: 'confused',
      grants: [{ permission: 'audit:read' }],
      denies: ['audit:read'],
    });

    const result = resolveRolePermissions(['confused'], { confused: role });

    expect(result.has('audit:read')).toBe(false);
  });

  it('multiple user roles: union of all resolved permissions', () => {
    const r1 = makeRole({ id: 'r1', grants: [{ permission: 'service:read' }] });
    const r2 = makeRole({ id: 'r2', grants: [{ permission: 'route:read' }] });

    const result = resolveRolePermissions(['r1', 'r2'], { r1, r2 });

    expect(result.has('service:read')).toBe(true);
    expect(result.has('route:read')).toBe(true);
  });

  it('empty role list: returns empty map', () => {
    const result = resolveRolePermissions([], {});
    expect(result.size).toBe(0);
  });

  it('unknown role IDs: silently ignored', () => {
    const result = resolveRolePermissions(['nonexistent'], {});
    expect(result.size).toBe(0);
  });
});

// ─── detectRoleCycle ──────────────────────────────────────────────────────────

describe('detectRoleCycle', () => {
  it('returns false for a role with no parents', () => {
    const role = makeRole({ id: 'viewer' });
    expect(detectRoleCycle(role, { viewer: role })).toBe(false);
  });

  it('returns false for a valid linear hierarchy', () => {
    const viewer = makeRole({ id: 'viewer' });
    const ops = makeRole({ id: 'ops', parent_ids: ['viewer'] });
    const admin = makeRole({ id: 'admin', parent_ids: ['ops'] });
    const allRoles = { viewer, ops, admin };
    expect(detectRoleCycle(admin, allRoles)).toBe(false);
  });

  it('returns true for a self-parent (role lists itself)', () => {
    const role = makeRole({ id: 'self-loop', parent_ids: ['self-loop'] });
    const allRoles = { 'self-loop': role };
    expect(detectRoleCycle(role, allRoles)).toBe(true);
  });

  it('returns true for A → B → A cycle', () => {
    const a = makeRole({ id: 'a', parent_ids: ['b'] });
    const b = makeRole({ id: 'b', parent_ids: ['a'] });
    const allRoles = { a, b };
    expect(detectRoleCycle(a, allRoles)).toBe(true);
  });

  it('returns true for longer cycle A → B → C → A', () => {
    const a = makeRole({ id: 'a', parent_ids: ['b'] });
    const b = makeRole({ id: 'b', parent_ids: ['c'] });
    const c = makeRole({ id: 'c', parent_ids: ['a'] });
    const allRoles = { a, b, c };
    expect(detectRoleCycle(a, allRoles)).toBe(true);
  });
});

// ─── validateRoleSave ─────────────────────────────────────────────────────────

describe('validateRoleSave', () => {
  it('returns ok for a valid role with no parents', () => {
    const role = makeRole({ id: 'viewer' });
    expect(validateRoleSave(role, {})).toEqual({ ok: true });
  });

  it('returns ok for a valid role with non-cyclic parents', () => {
    const viewer = makeRole({ id: 'viewer' });
    const ops = makeRole({ id: 'ops', parent_ids: ['viewer'] });
    expect(validateRoleSave(ops, { viewer })).toEqual({ ok: true });
  });

  it('rejects a role that lists itself as a parent', () => {
    const role = makeRole({ id: 'self', parent_ids: ['self'] });
    const result = validateRoleSave(role, { self: role });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/cannot list itself/i);
    }
  });

  it('rejects a role that would create a cycle', () => {
    const a = makeRole({ id: 'a', parent_ids: ['b'] });
    const b = makeRole({ id: 'b', parent_ids: ['a'] });
    const result = validateRoleSave(a, { a, b });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/cycle/i);
    }
  });

  it('rejects a new role that would close a cycle with existing roles', () => {
    // Existing: viewer → (no parent); ops → viewer
    const viewer = makeRole({ id: 'viewer' });
    const ops = makeRole({ id: 'ops', parent_ids: ['viewer'] });
    // Candidate: viewer updated to extend ops — would create viewer → ops → viewer
    const viewerUpdated = makeRole({ id: 'viewer', parent_ids: ['ops'] });
    const result = validateRoleSave(viewerUpdated, { viewer, ops });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/cycle/i);
    }
  });
});
