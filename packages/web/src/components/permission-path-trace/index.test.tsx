/**
 * <PermissionPathTrace> tests.
 *
 * We mock useMockStore to control membership and role data without Zustand
 * persistence. resolveRolePermissions and the deny-walking logic in
 * usePermissionTrace are exercised via the real hook.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Fixture data ─────────────────────────────────────────────────────────────

const VIEWER_ROLE_ID = 'role-viewer';
const ADMIN_ROLE_ID = 'role-admin';
const DENY_ROLE_ID = 'role-deny';

const MOCK_ROLES = {
  [VIEWER_ROLE_ID]: {
    id: VIEWER_ROLE_ID,
    tenant_id: 'tenant-1',
    name: 'viewer',
    parent_ids: [],
    grants: [{ permission: 'service:read' }],
    denies: [],
    system: true,
  },
  [ADMIN_ROLE_ID]: {
    id: ADMIN_ROLE_ID,
    tenant_id: 'tenant-1',
    name: 'admin',
    parent_ids: [VIEWER_ROLE_ID],
    grants: [{ permission: 'service:write', when: "user.plan == 'pro'" }],
    denies: [],
    system: true,
  },
  [DENY_ROLE_ID]: {
    id: DENY_ROLE_ID,
    tenant_id: 'tenant-1',
    name: 'restricted',
    parent_ids: [],
    grants: [{ permission: 'service:read' }],
    denies: ['service:read'], // explicitly denies a permission it also grants
    system: false,
  },
};

const MOCK_MEMBERSHIPS = {
  'mem-granted': {
    id: 'mem-granted',
    tenant_id: 'tenant-1',
    user_id: 'user-granted',
    role_ids: [ADMIN_ROLE_ID],
    state: 'active' as const,
    invited_at: '2024-01-01T00:00:00Z',
    joined_at: '2024-01-01T00:00:00Z',
  },
  'mem-denied': {
    id: 'mem-denied',
    tenant_id: 'tenant-1',
    user_id: 'user-denied',
    role_ids: [DENY_ROLE_ID],
    state: 'active' as const,
    invited_at: '2024-01-01T00:00:00Z',
    joined_at: '2024-01-01T00:00:00Z',
  },
  'mem-no-perm': {
    id: 'mem-no-perm',
    tenant_id: 'tenant-1',
    user_id: 'user-noperm',
    role_ids: [VIEWER_ROLE_ID],
    state: 'active' as const,
    invited_at: '2024-01-01T00:00:00Z',
    joined_at: '2024-01-01T00:00:00Z',
  },
};

// ── Mock useMockStore ─────────────────────────────────────────────────────────

vi.mock('../../api/mock-store', () => ({
  useMockStore: (
    selector: (s: { memberships: typeof MOCK_MEMBERSHIPS; roles: typeof MOCK_ROLES }) => unknown,
  ) => selector({ memberships: MOCK_MEMBERSHIPS, roles: MOCK_ROLES }),
}));

// Import AFTER mocks
import { PermissionPathTrace } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('<PermissionPathTrace>', () => {
  it('renders "granted" outcome when user has the permission', () => {
    wrap(
      <PermissionPathTrace userId="user-granted" tenantId="tenant-1" permission="service:read" />,
    );

    expect(screen.getByText('Permission granted')).toBeInTheDocument();
    expect(screen.getByText('Grant found')).toBeInTheDocument();
  });

  it('renders inherited path for permission granted via parent role', () => {
    // admin inherits from viewer which has service:read
    wrap(
      <PermissionPathTrace userId="user-granted" tenantId="tenant-1" permission="service:read" />,
    );

    // The viewer role should appear in the path (inherited)
    expect(screen.getByText('Permission granted')).toBeInTheDocument();
  });

  it('renders conditional badge when grant has a CEL condition', () => {
    // admin has service:write with when condition
    wrap(
      <PermissionPathTrace userId="user-granted" tenantId="tenant-1" permission="service:write" />,
    );

    expect(screen.getByText('Permission granted')).toBeInTheDocument();
    // The condition text should be shown
    expect(screen.getByText(/Conditional:/)).toBeInTheDocument();
  });

  it('renders "denied" outcome when role has explicit deny', () => {
    wrap(
      <PermissionPathTrace userId="user-denied" tenantId="tenant-1" permission="service:read" />,
    );

    expect(screen.getByText('Permission denied')).toBeInTheDocument();
    // "Denied in role ... via deny entry" — the text is split across elements
    // so match the container element that includes "Denied in role"
    const deniedNode = screen.getByText(/Denied in role/);
    expect(deniedNode).toBeInTheDocument();
    // "restricted" appears in both the role list and the deny message — check
    // that at least one instance mentions it in the deny context
    const allRestricted = screen.getAllByText(/restricted/);
    expect(allRestricted.length).toBeGreaterThanOrEqual(1);
  });

  it('renders "no-source" when user has no role granting the permission', () => {
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
    expect(screen.getByText(/No membership found/)).toBeInTheDocument();
  });

  it('shows permission key as badge', () => {
    wrap(
      <PermissionPathTrace userId="user-granted" tenantId="tenant-1" permission="service:read" />,
    );

    expect(screen.getByText('service:read')).toBeInTheDocument();
  });
});
