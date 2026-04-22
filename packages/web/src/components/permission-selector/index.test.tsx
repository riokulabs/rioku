/**
 * <PermissionSelector> tests.
 *
 * The component reads the permission catalog via usePermissionsCatalog(),
 * which in turn reads from useMockStore(). We mock useMockStore to avoid
 * Zustand persistence side-effects in tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { axe } from 'jest-axe';

// ── Mock useMockStore ─────────────────────────────────────────────────────────

const BUILT_IN_PERM = {
  key: 'service:read',
  description: 'View service configuration',
  source: 'built-in' as const,
};

const PLUGIN_MANIFEST_PERM = {
  key: 'com.acme.billing:invoice:read',
  description: 'Read billing invoices',
  source: 'plugin-manifest' as const,
};

const PLUGIN_DYNAMIC_PERM = {
  key: 'com.acme.crm:contact:read',
  description: 'Read CRM contacts (dynamic)',
  source: 'plugin-dynamic' as const,
};

const MOCK_PERMISSIONS = {
  'service:read': BUILT_IN_PERM,
  'com.acme.billing:invoice:read': PLUGIN_MANIFEST_PERM,
  'com.acme.crm:contact:read': PLUGIN_DYNAMIC_PERM,
};

vi.mock('../../api/mock-store', () => ({
  useMockStore: (selector: (s: { permissions: typeof MOCK_PERMISSIONS }) => unknown) =>
    selector({ permissions: MOCK_PERMISSIONS }),
}));

// Import AFTER mocks
import { PermissionSelector } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('<PermissionSelector>', () => {
  it('renders without crashing', () => {
    wrap(<PermissionSelector value={[]} onChange={vi.fn()} />);
  });

  it('shows built-in permissions in dropdown', async () => {
    const user = userEvent.setup();
    wrap(<PermissionSelector value={[]} onChange={vi.fn()} />);

    // Open the dropdown
    const input = screen.getByRole('combobox');
    await user.click(input);

    await waitFor(() => {
      expect(screen.getByText('service:read')).toBeInTheDocument();
    });
  });

  it('shows plugin permissions in dropdown', async () => {
    const user = userEvent.setup();
    wrap(<PermissionSelector value={[]} onChange={vi.fn()} />);

    const input = screen.getByRole('combobox');
    await user.click(input);

    await waitFor(() => {
      expect(screen.getByText('com.acme.billing:invoice:read')).toBeInTheDocument();
    });
  });

  it('shows "dynamic" badge for plugin-dynamic source permissions', async () => {
    const user = userEvent.setup();
    wrap(<PermissionSelector value={[]} onChange={vi.fn()} />);

    const input = screen.getByRole('combobox');
    await user.click(input);

    await waitFor(() => {
      expect(screen.getByText('com.acme.crm:contact:read')).toBeInTheDocument();
      expect(screen.getByText('dynamic')).toBeInTheDocument();
    });
  });

  it('excludes permissions listed in excludePermissions', async () => {
    const user = userEvent.setup();
    wrap(
      <PermissionSelector value={[]} onChange={vi.fn()} excludePermissions={['service:read']} />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);

    await waitFor(() => {
      expect(screen.queryByText('service:read')).not.toBeInTheDocument();
    });
  });

  it('calls onChange when a permission is selected', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    wrap(<PermissionSelector value={[]} onChange={handleChange} />);

    const input = screen.getByRole('combobox');
    await user.click(input);

    await waitFor(() => {
      expect(screen.getByText('service:read')).toBeInTheDocument();
    });

    await user.click(screen.getByText('service:read'));

    expect(handleChange).toHaveBeenCalledWith(['service:read']);
  });

  it('renders label when provided', () => {
    wrap(<PermissionSelector value={[]} onChange={vi.fn()} label="Permissions" />);
    expect(screen.getByText('Permissions')).toBeInTheDocument();
  });

  it('is accessible (axe clean)', async () => {
    const { container } = wrap(
      <PermissionSelector value={['service:read']} onChange={vi.fn()} label="Permissions" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
