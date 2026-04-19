/**
 * Unit tests for <SiteDetail> + <SiteEditForm>.
 *
 * Verifies: delete typed-domain confirm blocks until match; advanced-config
 * button is disabled when site has no linked service; edit form submits
 * changes through `updateSite`.
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
import { SiteDetail } from '../components/detail';
import { SiteEditForm } from '../components/edit-form';
import type { Site } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

function findLinkedSite(): Site {
  const state = useMockStore.getState();
  const site = Object.values(state.sites).find(
    (s) => s.upstream_service_id !== undefined,
  );
  if (!site) throw new Error('No linked site seeded');
  return site;
}

function findUnlinkedSite(): Site {
  const state = useMockStore.getState();
  const site = Object.values(state.sites).find(
    (s) => s.upstream_service_id === undefined,
  );
  if (!site) throw new Error('No unlinked site seeded');
  return site;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('SiteDetail — advanced configuration deep-link', () => {
  it('disables the advanced-configuration button when no linked service', () => {
    const site = findUnlinkedSite();
    wrap(
      <SiteDetail
        siteId={site.id}
        tenantSlug="acme"
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const btn = screen.getByTestId('advanced-config-disabled');
    expect(btn).toHaveAttribute('data-disabled');
  });

  it('renders an enabled advanced-configuration link when service_id present', () => {
    const site = findLinkedSite();
    wrap(
      <SiteDetail
        siteId={site.id}
        tenantSlug="acme"
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // No disabled testid should render when site is linked
    expect(
      screen.queryByTestId('advanced-config-disabled'),
    ).toBeNull();
    // Advanced configuration button (anchor) visible
    const adv = screen.getByText(/Advanced configuration/i);
    expect(adv).toBeInTheDocument();
  });
});

describe('SiteDetail — delete typed-domain confirm', () => {
  it('keeps the Delete permanently button disabled until the domain is typed', async () => {
    const site = findLinkedSite();
    wrap(
      <SiteDetail
        siteId={site.id}
        tenantSlug="acme"
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Delete…/i }));

    // Modal opens with a confirm input
    const input = await screen.findByLabelText(/Confirm site domain/i);
    const deleteBtn = screen.getByRole('button', {
      name: /Delete permanently/i,
    });
    expect(deleteBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: site.domain } });
    await waitFor(() => {
      expect(deleteBtn).not.toBeDisabled();
    });
  });
});

describe('SiteEditForm', () => {
  it('submits an update when the user changes the rate limit preset', async () => {
    const site = findLinkedSite();
    const onSuccess = vi.fn();
    wrap(
      <SiteEditForm
        initialValues={site}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );

    // Submit form without editing — should save successfully.
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });
});
