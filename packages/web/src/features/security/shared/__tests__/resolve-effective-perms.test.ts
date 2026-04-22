/**
 * Unit tests for resolve-effective-perms.ts
 *
 * Covers:
 *   - Simple case: role with direct grants only
 *   - Parent chain: role inherits from parent — both sets present
 *   - Cycle detection: parent chain A→B→A doesn't infinite-loop
 *   - De-dup: same permission granted via two roles shows both sources
 *   - Deny: denied permission removed from effective set
 *   - User resolver: aggregates across memberships
 *   - User resolver: rbac-policy role additions attributed correctly
 *   - User resolver: non-active memberships excluded
 */

import { describe, it, expect } from 'vitest';
import type { Role, Membership, RbacPolicy } from '../../../../api/resources/types';
import { resolveEffectiveRolePerms, resolveEffectiveUserPerms } from '../resolve-effective-perms';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_ROLE: Role = {
  id: 'role-viewer',
  tenant_id: 'tenant-1',
  name: 'Viewer',
  parent_ids: [],
  grants: [{ permission: 'service:read' }, { permission: 'route:read' }],
  denies: [],
  system: false,
};

const ADMIN_ROLE: Role = {
  id: 'role-admin',
  tenant_id: 'tenant-1',
  name: 'Admin',
  parent_ids: ['role-viewer'],
  grants: [{ permission: 'service:write' }],
  denies: [],
  system: false,
};

const DENY_ROLE: Role = {
  id: 'role-deny',
  tenant_id: 'tenant-1',
  name: 'Restricted',
  parent_ids: ['role-viewer'],
  grants: [{ permission: 'service:write' }],
  denies: ['service:read'],
  system: false,
};

const ROLE_A: Role = {
  id: 'role-a',
  tenant_id: 'tenant-1',
  name: 'Role A',
  parent_ids: ['role-b'],
  grants: [{ permission: 'a:perm' }],
  denies: [],
  system: false,
};

const ROLE_B: Role = {
  id: 'role-b',
  tenant_id: 'tenant-1',
  name: 'Role B',
  parent_ids: ['role-a'], // cycle: a→b→a
  grants: [{ permission: 'b:perm' }],
  denies: [],
  system: false,
};

const ROLES: Record<string, Role> = {
  'role-viewer': BASE_ROLE,
  'role-admin': ADMIN_ROLE,
};

// ─── resolveEffectiveRolePerms ─────────────────────────────────────────────────

describe('resolveEffectiveRolePerms', () => {
  it('returns direct grants for a role with no parents', () => {
    const grants = resolveEffectiveRolePerms('role-viewer', ROLES);
    const keys = grants.map((g) => g.permission);
    expect(keys).toContain('service:read');
    expect(keys).toContain('route:read');
    expect(keys).not.toContain('service:write');
  });

  it('includes inherited grants from parent role', () => {
    const grants = resolveEffectiveRolePerms('role-admin', ROLES);
    const keys = grants.map((g) => g.permission);
    // direct grant on admin
    expect(keys).toContain('service:write');
    // inherited from viewer
    expect(keys).toContain('service:read');
    expect(keys).toContain('route:read');
  });

  it('attributes direct grants with type "direct"', () => {
    const grants = resolveEffectiveRolePerms('role-admin', ROLES);
    const direct = grants.find((g) => g.permission === 'service:write');
    expect(direct).toBeDefined();
    expect(direct?.sources[0]?.type).toBe('direct');
    expect(direct?.sources[0]?.roleName).toBe('Admin');
  });

  it('attributes inherited grants with type "parent-role"', () => {
    const grants = resolveEffectiveRolePerms('role-admin', ROLES);
    const inherited = grants.find((g) => g.permission === 'service:read');
    expect(inherited).toBeDefined();
    expect(inherited?.sources[0]?.type).toBe('parent-role');
    expect(inherited?.sources[0]?.roleId).toBe('role-viewer');
  });

  it('removes permissions that appear in deny list', () => {
    const roles: Record<string, Role> = {
      'role-viewer': BASE_ROLE,
      'role-deny': DENY_ROLE,
    };
    const grants = resolveEffectiveRolePerms('role-deny', roles);
    const keys = grants.map((g) => g.permission);
    // service:read is denied by role-deny
    expect(keys).not.toContain('service:read');
    // service:write still present (not denied)
    expect(keys).toContain('service:write');
  });

  it('handles cycle in parent_ids without infinite loop', () => {
    const cycleRoles: Record<string, Role> = {
      'role-a': ROLE_A,
      'role-b': ROLE_B,
    };
    // Should not throw or hang. Both permissions should be collected.
    const grants = resolveEffectiveRolePerms('role-a', cycleRoles);
    const keys = grants.map((g) => g.permission);
    expect(keys).toContain('a:perm');
    expect(keys).toContain('b:perm');
  });

  it('returns results sorted alphabetically by permission key', () => {
    const grants = resolveEffectiveRolePerms('role-admin', ROLES);
    const keys = grants.map((g) => g.permission);
    expect(keys).toEqual([...keys].sort());
  });

  it('de-duplicates same permission from two paths, merging sources', () => {
    // role-multi has two parents both granting the same perm
    const parentA: Role = {
      id: 'parent-a',
      tenant_id: 'tenant-1',
      name: 'Parent A',
      parent_ids: [],
      grants: [{ permission: 'shared:perm' }],
      denies: [],
      system: false,
    };
    const parentB: Role = {
      id: 'parent-b',
      tenant_id: 'tenant-1',
      name: 'Parent B',
      parent_ids: [],
      grants: [{ permission: 'shared:perm' }],
      denies: [],
      system: false,
    };
    const multi: Role = {
      id: 'role-multi',
      tenant_id: 'tenant-1',
      name: 'Multi',
      parent_ids: ['parent-a', 'parent-b'],
      grants: [],
      denies: [],
      system: false,
    };
    const roles = { 'parent-a': parentA, 'parent-b': parentB, 'role-multi': multi };
    const grants = resolveEffectiveRolePerms('role-multi', roles);
    const entry = grants.find((g) => g.permission === 'shared:perm');
    expect(entry).toBeDefined();
    // Both parent sources should be present
    expect(entry?.sources.length).toBe(2);
    const roleIds = entry?.sources.map((s) => s.roleId) ?? [];
    expect(roleIds).toContain('parent-a');
    expect(roleIds).toContain('parent-b');
  });
});

// ─── resolveEffectiveUserPerms ─────────────────────────────────────────────────

describe('resolveEffectiveUserPerms', () => {
  const MEMBERSHIP: Membership = {
    id: 'mbr-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    role_ids: ['role-admin'],
    state: 'active',
    invited_at: '2025-01-01T00:00:00Z',
    joined_at: '2025-01-01T00:00:00Z',
  };

  it('resolves all permissions for a user with one role', () => {
    const grants = resolveEffectiveUserPerms(
      'user-1',
      'tenant-1',
      ROLES,
      { 'mbr-1': MEMBERSHIP },
      {},
    );
    const keys = grants.map((g) => g.permission);
    expect(keys).toContain('service:write');
    expect(keys).toContain('service:read');
    expect(keys).toContain('route:read');
  });

  it('returns empty array for user with no memberships', () => {
    const grants = resolveEffectiveUserPerms('user-99', 'tenant-1', ROLES, {}, {});
    expect(grants).toHaveLength(0);
  });

  it('excludes non-active memberships', () => {
    const pendingMembership: Membership = {
      ...MEMBERSHIP,
      id: 'mbr-pending',
      state: 'pending',
    };
    const grants = resolveEffectiveUserPerms(
      'user-1',
      'tenant-1',
      ROLES,
      { 'mbr-pending': pendingMembership },
      {},
    );
    expect(grants).toHaveLength(0);
  });

  it('applies rbac-policy role additions with correct source attribution', () => {
    const extraRole: Role = {
      id: 'role-extra',
      tenant_id: 'tenant-1',
      name: 'Extra',
      parent_ids: [],
      grants: [{ permission: 'audit:read' }],
      denies: [],
      system: false,
    };
    const policy: RbacPolicy = {
      id: 'pol-1',
      tenant_id: 'tenant-1',
      name: 'audit-access-policy',
      role_id: 'role-extra',
      subject_kind: 'user',
      subject_id: 'user-1',
      created_at: '2025-01-01T00:00:00Z',
    };
    const grants = resolveEffectiveUserPerms(
      'user-1',
      'tenant-1',
      { ...ROLES, 'role-extra': extraRole },
      { 'mbr-1': MEMBERSHIP },
      { 'pol-1': policy },
    );
    const auditGrant = grants.find((g) => g.permission === 'audit:read');
    expect(auditGrant).toBeDefined();
    expect(auditGrant?.sources[0]?.type).toBe('rbac-policy');
    expect(auditGrant?.sources[0]?.policyId).toBe('pol-1');
    expect(auditGrant?.sources[0]?.policyName).toBe('audit-access-policy');
  });

  it('ignores rbac-policy bindings for other subject_kinds', () => {
    const extraRole: Role = {
      id: 'role-extra',
      tenant_id: 'tenant-1',
      name: 'Extra',
      parent_ids: [],
      grants: [{ permission: 'audit:read' }],
      denies: [],
      system: false,
    };
    const groupPolicy: RbacPolicy = {
      id: 'pol-group',
      tenant_id: 'tenant-1',
      name: 'group-policy',
      role_id: 'role-extra',
      subject_kind: 'group', // not 'user'
      subject_id: 'user-1', // same id but kind is group
      created_at: '2025-01-01T00:00:00Z',
    };
    const grants = resolveEffectiveUserPerms(
      'user-1',
      'tenant-1',
      { ...ROLES, 'role-extra': extraRole },
      { 'mbr-1': MEMBERSHIP },
      { 'pol-group': groupPolicy },
    );
    const auditGrant = grants.find((g) => g.permission === 'audit:read');
    // group policy should NOT be applied to user subject
    expect(auditGrant).toBeUndefined();
  });

  it('handles cycle in parent_ids without infinite loop', () => {
    const cycleRoles: Record<string, Role> = {
      'role-a': ROLE_A,
      'role-b': ROLE_B,
    };
    const cycleMembership: Membership = {
      id: 'mbr-cycle',
      tenant_id: 'tenant-1',
      user_id: 'user-2',
      role_ids: ['role-a'],
      state: 'active',
      invited_at: '2025-01-01T00:00:00Z',
    };
    expect(() =>
      resolveEffectiveUserPerms(
        'user-2',
        'tenant-1',
        cycleRoles,
        { 'mbr-cycle': cycleMembership },
        {},
      ),
    ).not.toThrow();
  });
});
