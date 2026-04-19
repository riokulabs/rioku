/**
 * Unit tests for membership lifecycle actions.
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
import { MembershipActions } from '../components/membership-actions';
import {
  activateMembership,
  deactivateMembership,
  removeMembership,
} from '../api';

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

describe('MembershipActions — API unit tests', () => {
  it('activateMembership transitions state from pending to active', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');
    const acmeRole = Object.values(state.roles).find((r) => r.tenant_id === acmeTenant.id);
    if (!acmeRole) throw new Error('No acme role');

    // Create a pending membership
    const { inviteUser } = await import('../api');
    const { membershipId } = await inviteUser(
      'pending@example.com',
      'Pending User',
      acmeTenant.id,
      [acmeRole.id],
      false,
    );

    const before = useMockStore.getState().memberships[membershipId];
    expect(before?.state).toBe('pending');

    await activateMembership(membershipId);

    const after = useMockStore.getState().memberships[membershipId];
    expect(after?.state).toBe('active');
    expect(after?.joined_at).toBeDefined();
  });

  it('deactivateMembership emits an audit entry', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');

    // Use an existing active membership
    const activeMembership = Object.values(state.memberships).find(
      (m) => m.tenant_id === acmeTenant.id && m.state === 'active',
    );
    if (!activeMembership) throw new Error('No active membership');

    const auditsBefore = useMockStore.getState().audit.length;
    await deactivateMembership(activeMembership.id);

    const newState = useMockStore.getState();
    expect(newState.memberships[activeMembership.id]?.state).toBe('deactivated');
    expect(newState.audit.length).toBeGreaterThan(auditsBefore);

    const lastAudit = newState.audit.at(-1);
    expect(lastAudit?.action).toBe('user:membership.deactivate');
  });

  it('removeMembership sets state to removed', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');

    const activeMembership = Object.values(state.memberships).find(
      (m) => m.tenant_id === acmeTenant.id && m.state === 'active',
    );
    if (!activeMembership) throw new Error('No active membership');

    await removeMembership(activeMembership.id);

    const after = useMockStore.getState().memberships[activeMembership.id];
    expect(after?.state).toBe('removed');
  });
});

describe('MembershipActions — UI tests', () => {
  it('shows Activate button for pending membership', () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');

    // Use a membership directly with pending state
    const mockMembership = {
      id: 'test-membership',
      tenant_id: acmeTenant.id,
      user_id: 'test-user',
      role_ids: [],
      state: 'pending' as const,
      invited_at: new Date().toISOString(),
    };

    wrap(
      <MembershipActions
        membership={mockMembership}
        tenantSlug="acme"
      />,
    );

    expect(screen.getByRole('button', { name: /activate/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /remove/i })).toBeDefined();
  });

  it('shows Deactivate button for active membership', () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');

    const mockMembership = {
      id: 'test-membership',
      tenant_id: acmeTenant.id,
      user_id: 'test-user',
      role_ids: [],
      state: 'active' as const,
      invited_at: new Date().toISOString(),
    };

    wrap(
      <MembershipActions
        membership={mockMembership}
        tenantSlug="acme"
      />,
    );

    expect(screen.getByRole('button', { name: /deactivate/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /remove/i })).toBeDefined();
  });

  it('remove button requires typed tenant slug confirmation', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');

    const mockMembership = {
      id: 'test-membership-2',
      tenant_id: acmeTenant.id,
      user_id: 'test-user',
      role_ids: [],
      state: 'active' as const,
      invited_at: new Date().toISOString(),
    };

    wrap(
      <MembershipActions
        membership={mockMembership}
        tenantSlug="acme"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      // Modal should open with a text input
      expect(screen.getByPlaceholderText('acme')).toBeDefined();
    });

    // Remove button in modal should be disabled without correct slug
    const removeBtn = screen.getByRole('button', { name: /remove from tenant/i });
    expect(removeBtn).toBeDefined();
    expect(removeBtn.hasAttribute('disabled')).toBe(true);

    // Type the correct slug
    const input = screen.getByPlaceholderText('acme');
    fireEvent.change(input, { target: { value: 'acme' } });

    // Now the button should be enabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remove from tenant/i }).hasAttribute('disabled')).toBe(false);
    });
  });
});
