/**
 * Unit tests for <UserDetail>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

vi.mock('@monaco-editor/react', async () => {
  const { useEffect } = await import('react');
  const MockEditor = ({
    value,
    onChange,
    onMount,
    options,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    options?: { readOnly?: boolean };
  }) => {
    useEffect(() => {
      if (onMount) {
        const fakeModel = {};
        const fakeEditor = { getModel: () => fakeModel };
        const fakeMonaco = {
          editor: { setModelMarkers: vi.fn() },
          MarkerSeverity: { Error: 8 },
          languages: {
            register: vi.fn(),
            setMonarchTokensProvider: vi.fn(),
            setLanguageConfiguration: vi.fn(),
          },
        };
        onMount(fakeEditor, fakeMonaco);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <textarea
        aria-label="cel-editor"
        data-testid="monaco-stub"
        value={value ?? ''}
        readOnly={options?.readOnly ?? false}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  };
  return { default: MockEditor };
});

vi.mock('@/lib/cel-parser', () => ({
  parseCel: vi.fn().mockResolvedValue({ ok: true }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { UserDetail } from '../components/detail';

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

describe('UserDetail', () => {
  it('renders profile tab with user info', () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');

    // Find Derrick (currentUser)
    const derrick = Object.values(state.users).find((u) => u.email === 'derrick@rioku.dev');
    if (!derrick) throw new Error('No derrick user');

    const onClose = vi.fn();
    wrap(
      <UserDetail
        userId={derrick.id}
        currentTenantId={acmeTenant.id}
        tenantSlug="acme"
        onClose={onClose}
      />,
    );

    // Profile tab is shown by default — use getAllByText since name may appear in header + profile
    expect(screen.getAllByText(derrick.name).length).toBeGreaterThan(0);
    expect(screen.getAllByText(derrick.email).length).toBeGreaterThan(0);
  });

  it('renders memberships tab', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');

    const derrick = Object.values(state.users).find((u) => u.email === 'derrick@rioku.dev');
    if (!derrick) throw new Error('No derrick user');

    const onClose = vi.fn();
    wrap(
      <UserDetail
        userId={derrick.id}
        currentTenantId={acmeTenant.id}
        tenantSlug="acme"
        onClose={onClose}
      />,
    );

    // Click memberships tab
    fireEvent.click(screen.getByRole('tab', { name: /memberships/i }));

    await waitFor(() => {
      expect(screen.getByText(/Acme Corp/i)).toBeDefined();
    });
  });

  it('renders sessions tab', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');

    const derrick = Object.values(state.users).find((u) => u.email === 'derrick@rioku.dev');
    if (!derrick) throw new Error('No derrick user');

    const onClose = vi.fn();
    wrap(
      <UserDetail
        userId={derrick.id}
        currentTenantId={acmeTenant.id}
        tenantSlug="acme"
        onClose={onClose}
      />,
    );

    // Click sessions tab
    fireEvent.click(screen.getByRole('tab', { name: /sessions/i }));

    await waitFor(() => {
      // Sessions table rendered (may be empty if no sessions for this user)
      const sessionTab = screen.getByRole('tabpanel', { hidden: false });
      expect(sessionTab).toBeDefined();
    });
  });

  it('revoke-session fires mutation and marks session revoked', async () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant');

    // Find any non-revoked session
    const session = Object.values(state.sessions).find((s) => !s.revoked);
    if (!session) throw new Error('No non-revoked session');

    // Use revokeSession API directly
    const { revokeSession } = await import('../api');
    await revokeSession(session.id);

    const newState = useMockStore.getState();
    const updatedSession = newState.sessions[session.id];
    expect(updatedSession?.revoked).toBe(true);

    // Session still exists (not deleted) — audit trail requires it
    expect(updatedSession).toBeDefined();
  });
});
