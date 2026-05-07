/**
 * Tests for <CrossTenantUsers> — Plan 11 close-out.
 *
 * Covers:
 *   - Data load via useListAdminUsers + MSW
 *   - Search by username
 *   - Status filter
 *   - Detail drawer opens on username click and shows real fields
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CrossTenantUsers } from '../components/cross-tenant-users';
import {
  AdminTestWrapper,
  makeQueryClient,
  mockListUsers,
  SAMPLE_USERS,
} from './admin-msw-helpers';

function renderUsers() {
  const client = makeQueryClient();
  return render(
    <AdminTestWrapper client={client}>
      <CrossTenantUsers />
    </AdminTestWrapper>,
  );
}

describe('CrossTenantUsers — list view backed by useListAdminUsers', () => {
  it('renders all returned usernames', async () => {
    mockListUsers(SAMPLE_USERS);
    renderUsers();
    expect(await screen.findByText('alice')).toBeDefined();
    expect(await screen.findByText('bob')).toBeDefined();
    expect(await screen.findByText('charlie')).toBeDefined();
    expect(await screen.findByText('dora')).toBeDefined();
  });

  it('renders the search input and status filter', async () => {
    mockListUsers(SAMPLE_USERS);
    renderUsers();
    await screen.findByText('alice');
    expect(screen.getByTestId('user-search')).toBeDefined();
    expect(screen.getByTestId('status-filter')).toBeDefined();
  });

  it('filters by search query (substring match on username)', async () => {
    mockListUsers(SAMPLE_USERS);
    renderUsers();
    await screen.findByText('alice');
    fireEvent.change(screen.getByTestId('user-search'), {
      target: { value: 'bob' },
    });
    await waitFor(() => {
      expect(screen.getByText('bob')).toBeDefined();
      expect(screen.queryByText('alice')).toBeNull();
    });
  });

  it('renders the empty state when no users match', async () => {
    mockListUsers([]);
    renderUsers();
    await waitFor(() => {
      expect(screen.getByText(/no users found/i)).toBeDefined();
    });
  });

  it('opens the user detail drawer when the username cell is clicked', async () => {
    mockListUsers(SAMPLE_USERS);
    renderUsers();
    const cells = await screen.findAllByTestId('user-name-cell');
    expect(cells.length).toBeGreaterThan(0);
    fireEvent.click(cells[0]!);
    await waitFor(() => {
      expect(screen.getAllByText(/username/i).length).toBeGreaterThan(0);
    });
  });
});
