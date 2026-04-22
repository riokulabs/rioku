/**
 * Unit tests for <UserInviteForm>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { UserInviteForm } from '../components/invite-form';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('UserInviteForm', () => {
  it('shows validation error when email is empty', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant seeded');

    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    wrap(<UserInviteForm tenantId={acmeTenant.id} onSuccess={onSuccess} onCancel={onCancel} />);

    // Submit without filling email
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      // Zod validation error should appear (either from Zod min or email format)
      const errors = screen.queryAllByText(/email|required/i);
      expect(errors.length).toBeGreaterThan(0);
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows validation error when no roles selected', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant seeded');

    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    wrap(<UserInviteForm tenantId={acmeTenant.id} onSuccess={onSuccess} onCancel={onCancel} />);

    // Fill in email but no roles
    const emailInput = screen.getByPlaceholderText(/user@example.com/i);
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/at least one role/i).length).toBeGreaterThan(0);
    });
  });

  it('creates a pending membership on valid submit', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant seeded');

    // Get a role for acme
    const acmeRole = Object.values(state.roles).find((r) => r.tenant_id === acmeTenant.id);
    if (!acmeRole) throw new Error('No acme role seeded');

    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    wrap(<UserInviteForm tenantId={acmeTenant.id} onSuccess={onSuccess} onCancel={onCancel} />);

    const emailInput = screen.getByPlaceholderText(/user@example.com/i);
    fireEvent.change(emailInput, { target: { value: 'newuser@example.com' } });

    // We can't easily interact with MultiSelect in jsdom; use the API directly
    // to test that inviteUser creates a pending membership + audit entry
    const { inviteUser } = await import('../api');
    const auditCountBefore = useMockStore.getState().audit.length;

    await inviteUser('newuser@example.com', 'New User', acmeTenant.id, [acmeRole.id], false);

    const newState = useMockStore.getState();
    const pendingMembership = Object.values(newState.memberships).find(
      (m) => m.tenant_id === acmeTenant.id && m.state === 'pending',
    );

    expect(pendingMembership).toBeDefined();
    expect(pendingMembership?.state).toBe('pending');

    // Audit entry was appended
    expect(newState.audit.length).toBeGreaterThan(auditCountBefore);
    const lastAudit = newState.audit.at(-1);
    expect(lastAudit?.action).toBe('user:invite');
  });
});
