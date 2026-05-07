/**
 * Tests for <PermissionsCatalogPage> — verifies:
 *   1. Built-in + plugin permissions are listed with source badges.
 *   2. Source filter narrows the table to the chosen source.
 *   3. Search input filters by key / description substring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  useParams: () => ({ tenant: 'acme' }),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  PermissionsCatalogPage,
  PermissionSourceBadge,
} from '../permissions-catalog';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('PermissionsCatalogPage', () => {
  it('renders the catalog with at least one built-in and one plugin permission', () => {
    wrap(<PermissionsCatalogPage />);

    expect(
      screen.getByTestId('permissions-catalog-page'),
    ).toBeInTheDocument();

    // The seed registers a 'com.acme.billing:invoice:read' plugin perm.
    const pluginRow = screen.getByTestId(
      'perm-row-com.acme.billing:invoice:read',
    );
    expect(pluginRow).toBeInTheDocument();
    expect(within(pluginRow).getByText(/Plugin \(manifest\)/i)).toBeInTheDocument();

    // At least one built-in row is present.
    const builtInBadges = screen.getAllByText(/^Built-in$/);
    expect(builtInBadges.length).toBeGreaterThan(0);
  });

  it('source filter narrows the table to plugin-manifest only', () => {
    wrap(<PermissionsCatalogPage />);

    // Switch source filter to plugin-manifest.
    const select = screen.getByTestId('permissions-catalog-source-filter');
    // Mantine Select renders a hidden input + a clickable shell; fire a change
    // by opening + clicking option. We use direct change on the underlying input.
    fireEvent.click(select);
    const option = screen.getByRole('option', { name: /Plugin \(manifest\)/i });
    fireEvent.click(option);

    // Plugin row visible.
    expect(
      screen.getByTestId('perm-row-com.acme.billing:invoice:read'),
    ).toBeInTheDocument();
    // Built-in rows hidden — query rows that aren't the plugin row.
    const allRows = document.querySelectorAll('[data-testid^="perm-row-"]');
    expect(allRows.length).toBe(1);
  });

  it('search input filters rows by substring', () => {
    wrap(<PermissionsCatalogPage />);

    const search = screen.getByTestId('permissions-catalog-search');
    fireEvent.change(search, { target: { value: 'com.acme.billing' } });

    expect(
      screen.getByTestId('perm-row-com.acme.billing:invoice:read'),
    ).toBeInTheDocument();
    const allRows = document.querySelectorAll('[data-testid^="perm-row-"]');
    expect(allRows.length).toBe(1);
  });
});

describe('PermissionSourceBadge', () => {
  it('renders a label per source kind', () => {
    const { rerender } = render(
      <MantineProvider>
        <PermissionSourceBadge source="built-in" />
      </MantineProvider>,
    );
    expect(screen.getByText('Built-in')).toBeInTheDocument();

    rerender(
      <MantineProvider>
        <PermissionSourceBadge source="plugin-manifest" />
      </MantineProvider>,
    );
    expect(screen.getByText('Plugin (manifest)')).toBeInTheDocument();

    rerender(
      <MantineProvider>
        <PermissionSourceBadge source="plugin-dynamic" />
      </MantineProvider>,
    );
    expect(screen.getByText('Plugin (dynamic)')).toBeInTheDocument();
  });
});
