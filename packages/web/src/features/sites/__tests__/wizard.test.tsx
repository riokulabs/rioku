/**
 * Unit tests for <SiteCreateWizard>.
 *
 * Verifies:
 *   - Invalid hostname on step 1 blocks advance to step 2.
 *   - Full happy-path walkthrough (new_upstream + auto TLS) creates a site.
 *
 * Note: jsdom + Mantine `<Select>` (combobox) interactions are fiddly, so
 * the happy-path test uses the "new_upstream" branch which only uses
 * SegmentedControl + TextInput + NumberInput (all deterministic in jsdom).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { SiteCreateWizard } from '../components/wizard';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

function acmeId(): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!tenant) throw new Error('No acme tenant');
  return tenant.id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('SiteCreateWizard — step 1 validation', () => {
  it('blocks advance to step 2 when domain is invalid', () => {
    wrap(
      <SiteCreateWizard
        tenantId={acmeId()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Site name/i), {
      target: { value: 'my-site' },
    });
    fireEvent.change(screen.getByLabelText(/Domain/i), {
      target: { value: 'not a domain' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Still on step 1 — hostname fields still visible.
    expect(screen.getByLabelText(/Site name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Domain/i)).toBeInTheDocument();
  });
});

describe('SiteCreateWizard — schema at submit', () => {
  it('runs the full schema on Create and navigates back to the first invalid step', async () => {
    const onSuccess = vi.fn();
    wrap(
      <SiteCreateWizard
        tenantId={acmeId()}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );

    // Step 1 — fill hostname, advance.
    fireEvent.change(screen.getByLabelText(/Site name/i), {
      target: { value: 'invalid-port-site' },
    });
    fireEvent.change(screen.getByLabelText(/Domain/i), {
      target: { value: 'invalid.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 2 — switch to new_upstream, fill host, advance.
    const newUpstreamLabel = await screen.findByText(/Point at new upstream/i);
    fireEvent.click(newUpstreamLabel);
    const hostInput = await screen.findByLabelText(/Host/i);
    fireEvent.change(hostInput, { target: { value: 'backend.internal' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3 — TLS (auto default), advance.
    await waitFor(() => {
      expect(
        screen.getAllByText(/plaintext only/i).length,
      ).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 4 — policies (defaults), advance.
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Enable HTTP basic authentication/i),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 5 — review visible; walk back via Back button to the upstream step
    // and inject an out-of-range port. `validateStep(1)` doesn't check port,
    // but the schema's `min(1)/max(65535)` does — so the invalid state
    // survives until Create fires the full schema parse.
    await screen.findByTestId('wizard-create-site');
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));

    const portInput = await screen.findByLabelText(/Port/i);
    fireEvent.change(portInput, { target: { value: '99999' } });

    // Walk forward through the remaining steps (validateStep never re-checks
    // step 1's port; it only re-checks the step the user is leaving).
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    const createBtn = await screen.findByTestId('wizard-create-site');
    fireEvent.click(createBtn);

    // Schema parse fails: createSite never runs, onSuccess never fires.
    await waitFor(() => {
      // The upstream host input is only rendered on step 1, so its presence
      // confirms the wizard navigated back to that step after schema parse.
      expect(screen.getByLabelText(/Host/i)).toBeInTheDocument();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('SiteCreateWizard — happy path', () => {
  it('creates a site end-to-end using new_upstream + auto TLS', async () => {
    const onSuccess = vi.fn();
    wrap(
      <SiteCreateWizard
        tenantId={acmeId()}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );

    // Step 1 — hostname
    fireEvent.change(screen.getByLabelText(/Site name/i), {
      target: { value: 'happy-site' },
    });
    fireEvent.change(screen.getByLabelText(/Domain/i), {
      target: { value: 'happy.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 2 — switch to new_upstream (SegmentedControl), then fill host
    const newUpstreamLabel = await screen.findByText(/Point at new upstream/i);
    fireEvent.click(newUpstreamLabel);
    const hostInput = await screen.findByLabelText(/Host/i);
    fireEvent.change(hostInput, { target: { value: 'backend.internal' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3 — TLS auto is the default; just advance
    // (wait for the TLS radio group to be visible via one of its descriptions)
    await waitFor(() => {
      expect(
        screen.getAllByText(/plaintext only/i).length,
      ).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 4 — policies (defaults); advance
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Enable HTTP basic authentication/i),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 5 — review + create
    const createBtn = await screen.findByTestId('wizard-create-site');
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
    });
    const created = onSuccess.mock.calls[0]?.[0] as { domain: string };
    expect(created.domain).toBe('happy.example.com');
  });
});
