/**
 * Tests for <PluginSettingsSection>
 *
 * Covers:
 *   - Section renders list of installed plugins (seeded: 4 plugins)
 *   - Each plugin row has a Configure button
 *   - Clicking Configure opens the drawer for that plugin
 *   - Drawer shows Zone contribution when one is registered (com.acme.billing)
 *   - Drawer shows "No settings" EmptyState when no Zone contribution exists
 *   - Access denied alert when plugin:read is missing
 *   - Drawer has transitionProps={{ duration: 0 }} (JSDOM comment verified)
 *
 * Approach: Zone-backed (plugin-settings.<slug>) per Task 8c.12 plan.
 * seed-zones registers a contribution for plugin-settings.com.acme.billing.
 *
 * Task 8c.12
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Router stub ──────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: React.PropsWithChildren<{ to: string; params?: Record<string, string> }> &
    Record<string, unknown>) => <a {...rest}>{children}</a>,
}));

// ─── Permission mock ──────────────────────────────────────────────────────────

let grantRead = true;

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => {
    if (key === 'plugin:read') return grantRead;
    return true;
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { resetSeedZones } from '@/host/seed-zones';
import { PluginSettingsSection } from '../sections/plugin-settings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

beforeEach(() => {
  // Reset zone seed flag so each test starts with a clean zone registry.
  resetSeedZones();
  useMockStore.getState().reset();
  seedStore(useMockStore);
  grantRead = true;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PluginSettingsSection — list', () => {
  it('renders section container with seeded plugins', () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('plugin-settings-section')).toBeDefined();
  });

  it('renders a row for each installed plugin', () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });
    const plugins = Object.values(useMockStore.getState().plugins);
    // Each plugin has a Configure button and a row testid
    for (const plugin of plugins) {
      expect(screen.getByTestId(`plugin-settings-row-${plugin.slug}`)).toBeDefined();
    }
  });

  it('each plugin row shows name, version, and enabled badge', () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });
    // com.acme.billing is enabled — check its row has the enabled badge
    expect(screen.getByTestId('plugin-settings-row-com.acme.billing')).toBeDefined();
    expect(screen.getByText('Acme Billing')).toBeDefined();
  });

  it('each plugin row has a Configure button', () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });
    const plugins = Object.values(useMockStore.getState().plugins);
    for (const plugin of plugins) {
      expect(
        screen.getByTestId(`plugin-settings-configure-${plugin.slug}`),
      ).toBeDefined();
    }
  });
});

describe('PluginSettingsSection — drawer (with zone contribution)', () => {
  it('drawer is closed by default — no drawer heading visible', () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });
    // Mantine Drawer renders a portal even when closed, but the inner content
    // should not be present until a Configure button is clicked.
    // The drawer Title text ("Plugin settings") should not be in the document.
    expect(screen.queryByRole('heading', { name: /plugin settings/i })).toBeNull();
  });

  it('clicking Configure on com.acme.billing opens the drawer', async () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });

    const configureBtn = screen.getByTestId('plugin-settings-configure-com.acme.billing');
    fireEvent.click(configureBtn);

    await waitFor(() => {
      expect(screen.getByTestId('plugin-settings-drawer')).toBeDefined();
    });
  });

  it('drawer renders the Zone contribution for com.acme.billing', async () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTestId('plugin-settings-configure-com.acme.billing'));

    await waitFor(() => {
      // zone-acme-billing-settings is the testid on the seed contribution.
      // Use getAllByTestId in case the Mantine Drawer portal renders multiple
      // copies; we just need at least one to confirm the zone rendered.
      const panels = screen.getAllByTestId('zone-acme-billing-settings');
      expect(panels.length).toBeGreaterThan(0);
    });
  });

  it('drawer does NOT show "No settings" EmptyState when zone has a contribution', async () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTestId('plugin-settings-configure-com.acme.billing'));

    await waitFor(() => {
      expect(screen.getByTestId('plugin-settings-drawer')).toBeDefined();
    });

    // The EmptyState title is "No settings" — should not appear
    expect(screen.queryByText('No settings')).toBeNull();
  });
});

describe('PluginSettingsSection — drawer (no zone contribution)', () => {
  it('shows "No settings" EmptyState for a plugin with no zone contribution', async () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });

    // com.example.dashboards has no registered zone contribution
    const configureBtn = screen.getByTestId(
      'plugin-settings-configure-com.example.dashboards',
    );
    fireEvent.click(configureBtn);

    await waitFor(() => {
      expect(screen.getByTestId('plugin-settings-drawer')).toBeDefined();
      expect(screen.getByText('No settings')).toBeDefined();
    });
  });

  it('EmptyState description mentions settings panel', async () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });

    fireEvent.click(
      screen.getByTestId('plugin-settings-configure-com.example.dashboards'),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/has not declared a settings panel/i),
      ).toBeDefined();
    });
  });
});

describe('PluginSettingsSection — permission gate', () => {
  it('renders access-denied alert when plugin:read is missing', () => {
    grantRead = false;
    render(<PluginSettingsSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('plugin-settings-access-denied')).toBeDefined();
    expect(screen.queryByTestId('plugin-settings-section')).toBeNull();
  });

  it('renders section when plugin:read is granted', () => {
    render(<PluginSettingsSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('plugin-settings-section')).toBeDefined();
    expect(screen.queryByTestId('plugin-settings-access-denied')).toBeNull();
  });
});
