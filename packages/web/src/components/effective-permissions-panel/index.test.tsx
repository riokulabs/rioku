/**
 * <EffectivePermissionsPanel> tests.
 *
 * Mounts the panel with a seeded user (user-1 with role-admin which inherits
 * from role-viewer) and asserts:
 *   - the computed permissions list renders
 *   - source badges appear for direct and inherited grants
 *   - the filter TextInput narrows the list
 *   - empty state shows when user has no memberships
 *   - role scope works
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { Membership, Role, RbacPolicy } from '../../api/resources/types';

// ─── Fixture data ─────────────────────────────────────────────────────────────

const ROLES: Record<string, Role> = {
  'role-viewer': {
    id: 'role-viewer',
    tenant_id: 'tenant-1',
    name: 'Viewer',
    parent_ids: [],
    grants: [{ permission: 'service:read' }, { permission: 'route:read' }],
    denies: [],
    system: false,
  },
  'role-admin': {
    id: 'role-admin',
    tenant_id: 'tenant-1',
    name: 'Admin',
    parent_ids: ['role-viewer'],
    grants: [{ permission: 'service:write', when: "user.plan == 'pro'" }],
    denies: [],
    system: false,
  },
};

const MEMBERSHIPS: Record<string, Membership> = {
  'mbr-1': {
    id: 'mbr-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    role_ids: ['role-admin'],
    state: 'active',
    invited_at: '2025-01-01T00:00:00Z',
    joined_at: '2025-01-01T00:00:00Z',
  },
};

const RBAC_POLICIES: Record<string, RbacPolicy> = {};

// ─── Mock useMockStore ─────────────────────────────────────────────────────────

interface MockState {
  roles: Record<string, Role>;
  memberships: Record<string, Membership>;
  rbacPolicies: Record<string, RbacPolicy>;
}

let mockState: MockState = {
  roles: ROLES,
  memberships: MEMBERSHIPS,
  rbacPolicies: RBAC_POLICIES,
};

vi.mock('../../api/mock-store', () => ({
  useMockStore: (selector: (s: MockState) => unknown) => selector(mockState),
}));

// Import AFTER mocks
import { EffectivePermissionsPanel } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('<EffectivePermissionsPanel> — user scope', () => {
  beforeEach(() => {
    mockState = { roles: ROLES, memberships: MEMBERSHIPS, rbacPolicies: RBAC_POLICIES };
  });

  it('renders the panel container', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    expect(screen.getByTestId('effective-permissions-panel')).toBeInTheDocument();
  });

  it('shows the total permission count in the summary bar', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    // 3 effective permissions: service:read, service:write, route:read
    expect(screen.getByText(/3 effective permissions/)).toBeInTheDocument();
  });

  it('renders a row for each effective permission', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    expect(screen.getByTestId('perm-row-service:read')).toBeInTheDocument();
    expect(screen.getByTestId('perm-row-service:write')).toBeInTheDocument();
    expect(screen.getByTestId('perm-row-route:read')).toBeInTheDocument();
  });

  it('shows "direct" source badge for directly assigned permissions', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    // service:write is a direct grant on role-admin
    const badges = screen.getAllByText(/direct · Admin/);
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows "inherited" source badge for parent-role grants', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    // service:read is inherited from Viewer via Admin's parent chain
    const badges = screen.getAllByText(/inherited · Viewer/);
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows "conditional" badge for permissions with a CEL condition', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    expect(screen.getByText('conditional')).toBeInTheDocument();
  });

  it('filter input narrows the displayed permissions', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    const input = screen.getByTestId('perms-filter-input');
    fireEvent.change(input, { target: { value: 'service' } });
    // route:read should be gone
    expect(screen.queryByTestId('perm-row-route:read')).not.toBeInTheDocument();
    // service perms still visible
    expect(screen.getByTestId('perm-row-service:read')).toBeInTheDocument();
    expect(screen.getByTestId('perm-row-service:write')).toBeInTheDocument();
  });

  it('shows empty state for user with no memberships', () => {
    mockState = { roles: ROLES, memberships: {}, rbacPolicies: RBAC_POLICIES };
    wrap(<EffectivePermissionsPanel scope="user" id="user-99" tenantId="tenant-1" />);
    expect(screen.getByText(/No effective permissions found/)).toBeInTheDocument();
  });

  it('shows rbac-policy source badge when policy adds a role', () => {
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
      name: 'audit-policy',
      role_id: 'role-extra',
      subject_kind: 'user',
      subject_id: 'user-1',
      created_at: '2025-01-01T00:00:00Z',
    };
    mockState = {
      roles: { ...ROLES, 'role-extra': extraRole },
      memberships: MEMBERSHIPS,
      rbacPolicies: { 'pol-1': policy },
    };
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    expect(screen.getByTestId('perm-row-audit:read')).toBeInTheDocument();
    const policyBadge = screen.getByText(/policy · audit-policy/);
    expect(policyBadge).toBeInTheDocument();
  });
});

describe('<EffectivePermissionsPanel> — role scope', () => {
  beforeEach(() => {
    mockState = { roles: ROLES, memberships: MEMBERSHIPS, rbacPolicies: RBAC_POLICIES };
  });

  it('renders effective permissions for a role', () => {
    wrap(<EffectivePermissionsPanel scope="role" id="role-admin" />);
    // admin has 3 effective: service:write (direct), service:read + route:read (inherited)
    expect(screen.getByText(/3 effective permissions/)).toBeInTheDocument();
  });

  it('shows direct grant badge for a role', () => {
    wrap(<EffectivePermissionsPanel scope="role" id="role-admin" />);
    const direct = screen.getAllByText(/direct · Admin/);
    expect(direct.length).toBeGreaterThan(0);
  });

  it('shows inherited badge for parent-role grants', () => {
    wrap(<EffectivePermissionsPanel scope="role" id="role-admin" />);
    const inherited = screen.getAllByText(/inherited · Viewer/);
    expect(inherited.length).toBeGreaterThan(0);
  });

  it('shows error alert when tenantId is missing for user scope', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" />);
    expect(screen.getByText(/tenantId is required/)).toBeInTheDocument();
  });
});
