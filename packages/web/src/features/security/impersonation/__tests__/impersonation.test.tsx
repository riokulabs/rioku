/**
 * Tests for the impersonation entry form.
 * spec §8.2 / Task 1d.75
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { useMockStore } from '@/api/mock-store';
import { ImpersonationEntryForm } from '../components/entry-form';

// ─── Router mock ──────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

// ─── useDirtyForm mock (avoid useBlocker needing Router context) ─────────────

vi.mock('@/hooks/use-dirty-form', () => ({
  useDirtyForm: () => ({ isDirty: false }),
}));

// ─── useImpersonation mock ────────────────────────────────────────────────────

const mockEntry = vi.fn().mockResolvedValue(undefined);

vi.mock('@/hooks/use-impersonation', () => ({
  useImpersonation: () => ({
    state: 'idle' as const,
    session: null,
    entry: mockEntry,
    exit: vi.fn(),
    extendSession: vi.fn(),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedStore() {
  useMockStore.getState().reset();
  const store = useMockStore.getState();

  store.addEntity('tenants', {
    id: 'tenant-acme',
    slug: 'acme',
    name: 'Acme Corp',
    accent: '#22c55e',
    plan: 'enterprise',
    url_mode: 'path',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  store.addEntity('users', {
    id: 'user-alice',
    email: 'alice@acme.com',
    name: 'Alice Chen',
    disabled: false,
    totp_enabled: false,
    totp_enrolled: false,
    timezone: 'America/New_York',
    locale: 'en',
    reduced_motion: false,
    notification_preferences: { email: true, in_app: true, categories_muted: [] },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  store.addEntity('memberships', {
    id: 'mem-alice',
    tenant_id: 'tenant-acme',
    user_id: 'user-alice',
    role_ids: [],
    state: 'active',
    invited_at: new Date().toISOString(),
  });

  useMockStore.setState({ currentUserId: 'user-admin', currentTenantId: 'tenant-acme' });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ImpersonationEntryForm', () => {
  beforeEach(() => {
    seedStore();
    mockEntry.mockReset();
    mockEntry.mockResolvedValue(undefined);
  });

  it('renders all required fields', () => {
    renderWithProviders(<ImpersonationEntryForm />);

    // Use getAllByLabelText to handle Mantine's input-wrapping that produces multiple elements
    expect(screen.getAllByLabelText(/target tenant/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/reason/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/totp code/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/impersonation profile/i)).toBeDefined();
  });

  it('shows validation error if reason is too short', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationEntryForm />);

    const [reasonInput] = screen.getAllByLabelText(/reason/i);
    if (!reasonInput) throw new Error('reason input not found');
    await user.type(reasonInput, 'too short');
    await user.tab(); // blur

    await waitFor(() => {
      // Error message from schema: "Reason must be at least 20 characters"
      expect(screen.getByText(/20 characters/i)).toBeDefined();
    });
  });

  it('shows validation error if TOTP is not 6 digits', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationEntryForm />);

    const [totpInput] = screen.getAllByLabelText(/totp code/i);
    if (!totpInput) throw new Error('totp input not found');
    await user.type(totpInput, '123');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/6 digits/i)).toBeDefined();
    });
  });

  it('shows validation error if TOTP contains non-numeric chars', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationEntryForm />);

    const [totpInput] = screen.getAllByLabelText(/totp code/i);
    if (!totpInput) throw new Error('totp input not found');
    // Type 6 chars including non-numeric - maxLength=6 so only first 6 get in
    await user.type(totpInput, 'abc123');
    await user.tab();

    await waitFor(() => {
      // Could be "exactly 6 digits" (length) or "must be numeric" (regex)
      const errorEl = screen.queryByText(/numeric/i) ?? screen.queryByText(/6 digits/i);
      expect(errorEl).not.toBeNull();
    });
  });

  it('shows additional scope selector when profile is full', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationEntryForm />);

    // Find the "Full (read-only)" option in the SegmentedControl
    const fullButton = screen.getByText(/full \(read-only\)/i);
    await user.click(fullButton);

    await waitFor(() => {
      expect(screen.getByText(/additional scope/i)).toBeDefined();
    });
  });

  it('does not show additional scope selector when profile is minimal', () => {
    renderWithProviders(<ImpersonationEntryForm />);
    // Default profile is minimal
    expect(screen.queryByText(/additional scope/i)).toBeNull();
  });

  it('calls entry() with correct args on valid submit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationEntryForm />);

    // Select tenant (opens combobox) — use first match since label resolves multiple elements
    const [tenantSelect] = screen.getAllByLabelText(/target tenant/i);
    if (!tenantSelect) throw new Error('tenant select not found');
    await user.click(tenantSelect);

    await waitFor(() => {
      expect(screen.getByText(/Acme Corp/i)).toBeDefined();
    });
    await user.click(screen.getByText(/Acme Corp/i));

    // Fill reason
    const [reasonInput] = screen.getAllByLabelText(/reason/i);
    if (!reasonInput) throw new Error('reason input not found');
    await user.type(reasonInput, 'Investigating support ticket about role assignments');

    // Fill TOTP
    const [totpInput] = screen.getAllByLabelText(/totp code/i);
    if (!totpInput) throw new Error('totp input not found');
    await user.type(totpInput, '123456');

    // Submit
    const submitBtn = screen.getByRole('button', { name: /start impersonation/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'tenant-acme',
          reason: 'Investigating support ticket about role assignments',
          totpCode: '123456',
          profile: 'minimal',
        }),
      );
    });
  });

  it('shows valid ticketRef as URL', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationEntryForm />);

    const [ticketInput] = screen.getAllByLabelText(/ticket reference/i);
    if (!ticketInput) throw new Error('ticket input not found');
    await user.type(ticketInput, 'https://jira.example.com/browse/OPS-123');
    await user.tab();

    // No validation error should appear for valid URL
    await waitFor(() => {
      expect(screen.queryByText(/Must be a valid URL/i)).toBeNull();
    });
  });
});
