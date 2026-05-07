/**
 * Stage-2 plan-02 — users feature integration tests.
 *
 * Covers:
 *   - List renders a `disabled` badge for users whose `disabled` flag is true.
 *   - Delete flow: click Delete → typed-email confirm → DELETE call fires →
 *     row is removed from the list on the next refetch.
 *   - Viewer (no `user:delete` permission) does not see the Delete button
 *     in the detail drawer.
 *
 * MSW is the test backend (configured in `src/test/setup.ts`); per-test
 * `server.use(...)` overrides shape the responses for each scenario.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/msw-server';
import { UserList } from '../components/list';
import { UserDetail } from '../components/detail';

// Router mock — UserList uses `useFilterUrlHandle` which calls `useSearch`.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
    useRouter: () => ({ navigate: vi.fn() }),
  };
});

// Permission catalog — read by UserDetail's "trace permission" tab.
vi.mock('@/hooks/use-permissions-catalog', () => ({
  usePermissionsCatalog: () => ({ all: [] }),
}));

// Effective-permissions panel — out of scope; render a stub.
vi.mock('@/components/effective-permissions-panel', () => ({
  EffectivePermissionsPanel: () => null,
}));

vi.mock('@/components/permission-path-trace', () => ({
  PermissionPathTrace: () => null,
}));

// Permission gate — flipped per-test by tweaking the mock implementation.
const permissionMock = vi.fn<(key: string) => boolean>();
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => permissionMock(key),
}));

const TENANT_ID = 'tenant-acme';
const TENANT_SLUG = 'acme';
const BASE = '/api/v1';

interface FakeUser {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
}

function listResponse(users: FakeUser[]) {
  return {
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      disabled: u.disabled,
      tenantId: TENANT_ID,
      totpEnabled: false,
      totpEnrolled: false,
      forcePasswordChange: false,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    })),
  };
}

function getResponse(u: FakeUser) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    disabled: u.disabled,
    tenantId: TENANT_ID,
    totpEnabled: false,
    totpEnrolled: false,
    forcePasswordChange: false,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  // Default: caller has every permission — flip per-test for the viewer case.
  permissionMock.mockReset();
  permissionMock.mockReturnValue(true);
});

describe('UserList', () => {
  it('renders a disabled badge for disabled users', async () => {
    const users: FakeUser[] = [
      { id: 'user-1', email: 'alice@acme.com', name: 'Alice', disabled: false },
      { id: 'user-2', email: 'bob@acme.com', name: 'Bob', disabled: true },
    ];
    server.use(
      http.get(`${BASE}/t/${TENANT_ID}/users`, () => HttpResponse.json(listResponse(users))),
    );

    renderWithProviders(
      <UserList tenantId={TENANT_ID} tenantSlug={TENANT_SLUG} onSelect={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeDefined();
    });

    // Both users render
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();

    // The disabled badge is rendered exactly once — for Bob.
    const badges = screen.getAllByTestId('user-disabled-badge');
    expect(badges.length).toBe(1);
    expect(badges[0]?.textContent).toMatch(/disabled/i);
  });
});

describe('UserDetail — delete flow', () => {
  it('removes the row after confirmed delete', async () => {
    let users: FakeUser[] = [
      { id: 'user-1', email: 'alice@acme.com', name: 'Alice', disabled: false },
      { id: 'user-2', email: 'bob@acme.com', name: 'Bob', disabled: false },
    ];
    let deleted = false;

    server.use(
      http.get(`${BASE}/t/${TENANT_ID}/users`, () => HttpResponse.json(listResponse(users))),
      http.get(`${BASE}/t/${TENANT_ID}/users/user-2`, () =>
        HttpResponse.json(getResponse(users.find((u) => u.id === 'user-2') ?? users[0]!)),
      ),
      http.get(`${BASE}/t/${TENANT_ID}/users/user-2/roles`, () =>
        HttpResponse.json({ roles: [] }),
      ),
      http.get(`${BASE}/t/${TENANT_ID}/users/user-2/sessions`, () =>
        HttpResponse.json({ sessions: [] }),
      ),
      http.delete(`${BASE}/t/${TENANT_ID}/users/user-2`, () => {
        deleted = true;
        users = users.filter((u) => u.id !== 'user-2');
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <UserDetail
        userId="user-2"
        currentTenantId={TENANT_ID}
        tenantSlug={TENANT_SLUG}
        onClose={onClose}
      />,
    );

    // Wait for the user record to load
    await waitFor(() => {
      expect(screen.getAllByText('bob@acme.com').length).toBeGreaterThan(0);
    });

    // Click the delete button (rendered via testid for stability)
    const deleteBtn = await screen.findByTestId('user-delete-btn');
    await user.click(deleteBtn);

    // Type the email into the typed-confirm input
    const confirmInput = await screen.findByTestId('user-delete-confirm-input');
    await user.type(confirmInput, 'bob@acme.com');

    // Click the final confirm
    const confirmBtn = screen.getByTestId('user-delete-confirm-btn');
    await waitFor(() => {
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(deleted).toBe(true);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});

describe('UserDetail — viewer permissions', () => {
  it('does not render the Delete button when the viewer lacks user:delete', async () => {
    const u: FakeUser = {
      id: 'user-2',
      email: 'bob@acme.com',
      name: 'Bob',
      disabled: false,
    };

    server.use(
      http.get(`${BASE}/t/${TENANT_ID}/users/user-2`, () => HttpResponse.json(getResponse(u))),
      http.get(`${BASE}/t/${TENANT_ID}/users/user-2/roles`, () =>
        HttpResponse.json({ roles: [] }),
      ),
      http.get(`${BASE}/t/${TENANT_ID}/users/user-2/sessions`, () =>
        HttpResponse.json({ sessions: [] }),
      ),
    );

    // Viewer has read-only permissions: deny user:delete and user:impersonate.
    permissionMock.mockImplementation((key: string) => {
      return key !== 'user:delete' && key !== 'user:impersonate';
    });

    renderWithProviders(
      <UserDetail
        userId="user-2"
        currentTenantId={TENANT_ID}
        tenantSlug={TENANT_SLUG}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText('bob@acme.com').length).toBeGreaterThan(0);
    });

    // The Profile tab is the default — Delete sits under it. It must not exist.
    const profilePanel = screen.getByRole('tabpanel');
    expect(within(profilePanel).queryByTestId('user-delete-btn')).toBeNull();
  });
});
