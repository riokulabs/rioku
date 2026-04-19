/**
 * Unit tests for the Installed plugins tab.
 *
 * Covers:
 *   - List renders 4 seeded plugins
 *   - Enable/disable toggle flips store state + emits audit entry
 *   - Uninstall modal requires slug confirmation, then removes plugin
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a {...(props as Record<string, unknown>)}>{children}</a>
  ),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { InstalledPluginList } from '../components/list';
import { UninstallPluginModal } from '../components/uninstall-modal';

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

describe('InstalledPluginList', () => {
  it('renders all seeded installed plugins', () => {
    const onSelect = vi.fn();
    const onUninstall = vi.fn();
    wrap(
      <InstalledPluginList
        tenantId="any-tenant"
        onSelect={onSelect}
        onUninstall={onUninstall}
      />,
    );

    // 4 seeded plugins — names should all be present
    expect(screen.getByText('Acme Billing')).toBeTruthy();
    expect(screen.getByText('Custom Dashboards')).toBeTruthy();
    expect(screen.getByText('Rioku Slack Connector')).toBeTruthy();
    expect(screen.getByText('Broken Plugin (Demo)')).toBeTruthy();
  });

  it('shows the stage-1 tenant-scope note', () => {
    wrap(
      <InstalledPluginList
        tenantId="any-tenant"
        onSelect={vi.fn()}
        onUninstall={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Stage 1 shows all installed plugins/i),
    ).toBeTruthy();
  });

  it('enable/disable switch toggles the plugin in the store', async () => {
    wrap(
      <InstalledPluginList
        tenantId="any-tenant"
        onSelect={vi.fn()}
        onUninstall={vi.fn()}
      />,
    );

    // Acme Billing starts enabled — find the switch by aria-label
    const initialState = useMockStore.getState();
    const acmePlugin = Object.values(initialState.plugins).find(
      (p) => p.slug === 'com.acme.billing',
    );
    expect(acmePlugin?.enabled).toBe(true);

    const toggle = screen.getByLabelText(/Disable Acme Billing/i);
    fireEvent.click(toggle);

    await waitFor(
      () => {
        const state = useMockStore.getState();
        const acmeAfter = Object.values(state.plugins).find(
          (p) => p.slug === 'com.acme.billing',
        );
        expect(acmeAfter?.enabled).toBe(false);
      },
      { timeout: 2000 },
    );

    const after = useMockStore.getState();
    const recent = after.audit.slice(-1)[0];
    expect(recent?.action).toBe('plugin:disable');
    expect(recent?.resource_type).toBe('plugin');
  });

  it('calls onUninstall when menu → Uninstall is clicked', async () => {
    const user = userEvent.setup();
    const onUninstall = vi.fn();
    wrap(
      <InstalledPluginList
        tenantId="any-tenant"
        onSelect={vi.fn()}
        onUninstall={onUninstall}
      />,
    );

    // Open the actions menu for the first plugin
    const actionButtons = screen.getAllByLabelText(/Actions for /i);
    expect(actionButtons.length).toBeGreaterThan(0);
    const firstAction = actionButtons[0];
    if (!firstAction) throw new Error('No action buttons');
    await user.click(firstAction);

    // Menu item should be rendered — use findByRole for portaled dropdown
    const uninstallItem = await screen.findByRole('menuitem', { name: /Uninstall/i });
    await user.click(uninstallItem);

    expect(onUninstall).toHaveBeenCalledOnce();
  });
});

describe('UninstallPluginModal', () => {
  it('disables the Uninstall button until the slug is typed exactly', async () => {
    const plugin = Object.values(useMockStore.getState().plugins).find(
      (p) => p.slug === 'com.acme.billing',
    );
    if (!plugin) throw new Error('No seeded plugin');

    const onClose = vi.fn();
    const onSuccess = vi.fn();
    wrap(
      <UninstallPluginModal
        plugin={plugin}
        opened={true}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const submit = screen.getByRole('button', { name: /Uninstall permanently/i });
    // Disabled while slug mismatches
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText(/Confirm plugin slug/i);
    fireEvent.change(input, { target: { value: 'wrong-slug' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: plugin.slug } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);

    await waitFor(
      () => {
        const state = useMockStore.getState();
        const stillThere = Object.values(state.plugins).find((p) => p.id === plugin.id);
        expect(stillThere).toBeUndefined();
      },
      { timeout: 2000 },
    );

    const after = useMockStore.getState();
    const recent = after.audit.slice(-1)[0];
    expect(recent?.action).toBe('plugin:uninstall');
    expect(onSuccess).toHaveBeenCalled();
  });
});
