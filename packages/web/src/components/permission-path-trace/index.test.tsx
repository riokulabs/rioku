/**
 * <PermissionPathTrace> tests.
 *
 * The hook beneath the component (`usePermissionTrace`) reads from the
 * daemon's flat per-tenant role API. We mock those generated hooks so the
 * trace component renders deterministic outcomes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface FakeRole {
  id: string;
  name: string;
  permissions: string[];
}

let allRoles: FakeRole[] = [];
let userRoleAssignments: Record<string, { id: string; name: string }[]> = {};

vi.mock('@/api/generated/roles/roles', () => ({
  useListRoles: () => ({ data: { data: { roles: allRoles } } }),
  useListUserRoles: (_tenant: string, userId: string) => ({
    data: { data: { roles: userRoleAssignments[userId] ?? [] } },
    isLoading: false,
  }),
}));

import { PermissionPathTrace } from './index';

function wrap(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

const ADMIN: FakeRole = {
  id: 'role-admin',
  name: 'admin',
  permissions: ['service:read', 'service:write'],
};

const VIEWER: FakeRole = {
  id: 'role-viewer',
  name: 'viewer',
  permissions: ['service:read'],
};

beforeEach(() => {
  allRoles = [ADMIN, VIEWER];
  userRoleAssignments = {
    'user-granted': [{ id: 'role-admin', name: 'admin' }],
    'user-noperm': [{ id: 'role-viewer', name: 'viewer' }],
  };
});

describe('<PermissionPathTrace>', () => {
  it('renders "granted" outcome when user has the permission', () => {
    wrap(
      <PermissionPathTrace userId="user-granted" tenantId="tenant-1" permission="service:read" />,
    );

    expect(screen.getByText('Permission granted')).toBeInTheDocument();
    expect(screen.getByText('Grant found')).toBeInTheDocument();
  });

  it('shows the granting role name in the trace', () => {
    wrap(
      <PermissionPathTrace userId="user-granted" tenantId="tenant-1" permission="service:write" />,
    );

    expect(screen.getByText('Permission granted')).toBeInTheDocument();
    // role list renders the admin role name
    expect(screen.getAllByText(/admin/).length).toBeGreaterThan(0);
  });

  it('renders "no-source" when none of the assigned roles list the permission', () => {
    wrap(
      <PermissionPathTrace userId="user-noperm" tenantId="tenant-1" permission="service:write" />,
    );

    expect(screen.getByText('Permission not found')).toBeInTheDocument();
    expect(screen.getByText('No role grants this permission')).toBeInTheDocument();
  });

  it('renders error for unknown user/tenant combo', () => {
    wrap(
      <PermissionPathTrace
        userId="user-unknown"
        tenantId="tenant-unknown"
        permission="service:read"
      />,
    );

    expect(screen.getByText('Permission not found')).toBeInTheDocument();
    expect(screen.getByText(/No role assignments found/)).toBeInTheDocument();
  });

  it('shows permission key as badge', () => {
    wrap(
      <PermissionPathTrace userId="user-granted" tenantId="tenant-1" permission="service:read" />,
    );

    expect(screen.getByText('service:read')).toBeInTheDocument();
  });
});
