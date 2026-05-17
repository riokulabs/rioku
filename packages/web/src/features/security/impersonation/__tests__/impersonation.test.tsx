/**
 * Tests for the impersonation entry form.
 * spec §8.2 / Task 1d.75
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/msw-server';
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

// ─── Real-API mode flag — flipped per-test ──────────────────────────────────

const realApiMock = vi.hoisted(() => ({ value: false }));
vi.mock('@/api/mode', () => ({
  isRealApi: () => realApiMock.value,
  useMocks: () => !realApiMock.value,
}));

// ─── Active-impersonation holder mock ────────────────────────────────────────

const setActiveImp = vi.fn();
vi.mock('@/api/active-impersonation', () => ({
  setActiveImpersonationId: (id: string | null) => {
    setActiveImp(id);
  },
  getActiveImpersonationId: () => null,
}));

// ─── Admin-tenants list mock — populates the Target tenant Select ───────────

vi.mock('@/api/generated/admin/admin', () => ({
  useListAdminTenants: () => ({
    data: {
      data: {
        items: [
          { id: 'tenant-acme', slug: 'tenant-acme', name: 'Acme Corp' },
          { id: 'tenant-beta', slug: 'tenant-beta', name: 'Beta Workspace' },
        ],
      },
    },
    isLoading: false,
  }),
}));

// ─── Generated impersonation client mock ────────────────────────────────────

const mockStartMutate = vi.fn().mockResolvedValue({
  data: { id: 'imp-daemon-001' },
  status: 201,
});
vi.mock('../realApi', () => ({
  useStartImpersonation: () => ({
    mutateAsync: mockStartMutate,
    isPending: false,
  }),
  getListImpersonationSessionsQueryKey: () => ['/api/v1/admin/impersonation'],
  // Other re-exports — present for symmetry. Not used by the entry form.
  useEndImpersonation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTouchImpersonation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useListImpersonationSessions: () => ({ data: undefined }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-acme';

/**
 * Pick a tenant in the Mantine `<Select>` Target tenant field. Mantine's
 * Combobox renders options as divs with `data-combobox-option` rather
 * than `role="option"` (jsdom-flavoured query), so use the option's
 * label text instead of getByRole. The Select opens on focus; type the
 * tenant slug to filter, then commit with Enter.
 */
async function selectTenant(user: ReturnType<typeof userEvent.setup>) {
  const [combobox] = screen.getAllByLabelText(/target tenant/i);
  if (!combobox) throw new Error('target tenant combobox not found');
  await user.click(combobox);
  await user.keyboard('tenant-acme');
  // Mock returns slug `tenant-acme` + name `Acme Corp` → label is
  // `Acme Corp (tenant-acme)`. Filtering should leave one match.
  const option = await screen.findByText(/Acme Corp \(tenant-acme\)/i);
  await user.click(option);
}

/**
 * Stub the daemon `GET /api/v1/t/{tenant}/users` response so the user-picker
 * has data once a tenant id is entered. Tests that don't fill in the tenant
 * field never trigger the request.
 */
function seedUsersHandler() {
  server.use(
    http.get(`*/api/v1/t/${TENANT_ID}/users`, () =>
      HttpResponse.json({
        users: [
          {
            id: 'user-alice',
            email: 'alice@acme.com',
            name: 'Alice Chen',
            disabled: false,
            tenantId: TENANT_ID,
            totpEnabled: false,
            totpEnrolled: false,
            forcePasswordChange: false,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ImpersonationEntryForm', () => {
  beforeEach(() => {
    seedUsersHandler();
    mockEntry.mockReset();
    mockEntry.mockResolvedValue(undefined);
    mockStartMutate.mockReset();
    mockStartMutate.mockResolvedValue({ data: { id: 'imp-daemon-001' }, status: 201 });
    setActiveImp.mockReset();
    realApiMock.value = false;
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

    await selectTenant(user);

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
          tenant_id: TENANT_ID,
          reason: 'Investigating support ticket about role assignments',
          totpCode: '123456',
          profile: 'minimal',
        }),
      );
    });
  });

  it('does not call the daemon mutation directly — delegates exclusively to entry()', async () => {
    // After the double-call fix, the form only calls entry() from useImpersonation().
    // The mutation dispatch and active-id mirroring are useImpersonation's responsibility,
    // tested in use-impersonation.test.ts. The form must not bypass that abstraction.
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationEntryForm />);

    await selectTenant(user);

    const [reasonInput] = screen.getAllByLabelText(/reason/i);
    if (!reasonInput) throw new Error('reason input not found');
    await user.type(reasonInput, 'Investigating support ticket about role assignments');

    const [totpInput] = screen.getAllByLabelText(/totp code/i);
    if (!totpInput) throw new Error('totp input not found');
    await user.type(totpInput, '123456');

    const submitBtn = screen.getByRole('button', { name: /start impersonation/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT_ID,
          reason: 'Investigating support ticket about role assignments',
          totpCode: '123456',
        }),
      );
    });
    // Form must never call the daemon mutation directly.
    expect(mockStartMutate).not.toHaveBeenCalled();
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
