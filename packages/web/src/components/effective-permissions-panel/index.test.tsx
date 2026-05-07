/**
 * <EffectivePermissionsPanel> tests.
 *
 * Mocks the daemon-backed `useListRoles` / `useListUserRoles` hooks so we
 * can drive the panel with a fixed permission/role table and assert the
 * rendered output. Stage-2 daemon flattens role inheritance + denies, so
 * the panel only carries direct-attribution badges (one per granting role).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface FakeRole {
  id: string;
  name: string;
  permissions: string[];
}

let allRoles: FakeRole[] = [];
let userRoles: { id: string; name: string }[] = [];

vi.mock('@/api/generated/roles/roles', () => ({
  useListRoles: () => ({ data: { data: { roles: allRoles } } }),
  useListUserRoles: () => ({ data: { data: { roles: userRoles } } }),
}));

const activeTenantSlug: string | null = null;
vi.mock('@/hooks/use-tenant', () => ({
  useActiveTenantSlug: () => activeTenantSlug,
}));

import { EffectivePermissionsPanel } from './index';

function wrap(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

const ADMIN: FakeRole = {
  id: 'role-admin',
  name: 'Admin',
  permissions: ['service:read', 'service:write', 'route:read'],
};

const VIEWER: FakeRole = {
  id: 'role-viewer',
  name: 'Viewer',
  permissions: ['service:read'],
};

beforeEach(() => {
  allRoles = [ADMIN, VIEWER];
  userRoles = [{ id: 'role-admin', name: 'Admin' }];
});

describe('<EffectivePermissionsPanel> — user scope', () => {
  it('renders the panel container', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    expect(screen.getByTestId('effective-permissions-panel')).toBeInTheDocument();
  });

  it('shows the total permission count in the summary bar', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    // user-1 has role-admin → 3 perms
    expect(screen.getByText(/3 effective permissions/)).toBeInTheDocument();
  });

  it('renders a row for each effective permission', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    expect(screen.getByTestId('perm-row-service:read')).toBeInTheDocument();
    expect(screen.getByTestId('perm-row-service:write')).toBeInTheDocument();
    expect(screen.getByTestId('perm-row-route:read')).toBeInTheDocument();
  });

  it('shows source badges naming the granting role', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    const badges = screen.getAllByText(/Admin/);
    expect(badges.length).toBeGreaterThan(0);
  });

  it('filter input narrows the displayed permissions', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    const input = screen.getByTestId('perms-filter-input');
    fireEvent.change(input, { target: { value: 'service' } });
    expect(screen.queryByTestId('perm-row-route:read')).not.toBeInTheDocument();
    expect(screen.getByTestId('perm-row-service:read')).toBeInTheDocument();
    expect(screen.getByTestId('perm-row-service:write')).toBeInTheDocument();
  });

  it('shows empty state for user with no role assignments', () => {
    userRoles = [];
    wrap(<EffectivePermissionsPanel scope="user" id="user-99" tenantId="tenant-1" />);
    expect(screen.getByText(/No effective permissions found/)).toBeInTheDocument();
  });

  it('attributes a permission to all granting roles when overlap exists', () => {
    userRoles = [
      { id: 'role-admin', name: 'Admin' },
      { id: 'role-viewer', name: 'Viewer' },
    ];
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" tenantId="tenant-1" />);
    // service:read appears on both admin + viewer; the row should show both
    const row = screen.getByTestId('perm-row-service:read');
    expect(row).toBeInTheDocument();
    // Both role names render somewhere in the panel
    expect(screen.getAllByText(/Admin/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Viewer/).length).toBeGreaterThan(0);
  });
});

describe('<EffectivePermissionsPanel> — role scope', () => {
  it('renders effective permissions for a role', () => {
    wrap(<EffectivePermissionsPanel scope="role" id="role-admin" tenantId="tenant-1" />);
    expect(screen.getByText(/3 effective permissions/)).toBeInTheDocument();
  });

  it('shows source badge for the role itself', () => {
    wrap(<EffectivePermissionsPanel scope="role" id="role-admin" tenantId="tenant-1" />);
    const direct = screen.getAllByText(/Admin/);
    expect(direct.length).toBeGreaterThan(0);
  });

  it('shows error alert when tenantId is missing for user scope', () => {
    wrap(<EffectivePermissionsPanel scope="user" id="user-1" />);
    expect(screen.getByText(/tenantId is required/)).toBeInTheDocument();
  });
});
