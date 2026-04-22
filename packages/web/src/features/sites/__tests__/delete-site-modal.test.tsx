/**
 * Unit tests for <DeleteSiteModal>.
 *
 * The shared typed-domain delete Modal is used both from <SiteDetail> and
 * from the sites list-row action handler. These tests verify:
 *   - the "Delete permanently" button is disabled until the domain is typed,
 *   - typing the domain enables it,
 *   - clicking it calls `deleteSite` and fires `onSuccess`,
 *   - the site is gone from the mock store afterwards.
 *
 * This replaces the `window.prompt`-based list-delete flow that was
 * untestable in jsdom.
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
import { DeleteSiteModal } from '../components/delete-site-modal';
import type { Site } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

function firstSite(): Site {
  const state = useMockStore.getState();
  const site = Object.values(state.sites)[0];
  if (!site) throw new Error('No sites seeded');
  return site;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('DeleteSiteModal', () => {
  it('keeps the Delete permanently button disabled until the domain is typed', async () => {
    const site = firstSite();
    wrap(<DeleteSiteModal opened site={site} onClose={vi.fn()} onSuccess={vi.fn()} />);

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

  it('calls onSuccess and removes the site from the store on confirm', async () => {
    const site = firstSite();
    const onSuccess = vi.fn();
    wrap(<DeleteSiteModal opened site={site} onClose={vi.fn()} onSuccess={onSuccess} />);

    const input = await screen.findByLabelText(/Confirm site domain/i);
    fireEvent.change(input, { target: { value: site.domain } });

    const deleteBtn = screen.getByRole('button', {
      name: /Delete permanently/i,
    });
    await waitFor(() => {
      expect(deleteBtn).not.toBeDisabled();
    });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
    });
    expect(useMockStore.getState().sites[site.id]).toBeUndefined();
  });

  it('does nothing when site is null', () => {
    wrap(<DeleteSiteModal opened site={null} onClose={vi.fn()} onSuccess={vi.fn()} />);

    const deleteBtn = screen.getByRole('button', {
      name: /Delete permanently/i,
    });
    expect(deleteBtn).toBeDisabled();
  });
});
