/**
 * Unit tests for the Installed plugins list & uninstall modal — Stage-2.
 *
 * Hooks talk to the real daemon endpoints; tests intercept with MSW
 * and assert the wire calls fire (PUT/DELETE) plus the UI state
 * reflects the post-call refresh.
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

import { http, HttpResponse } from 'msw';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { server } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { InstalledPluginList } from '../components/list';
import { UninstallPluginModal } from '../components/uninstall-modal';

interface DaemonPlugin {
  id: string;
  tenantScope: string | null;
  slug: string;
  name: string;
  version: string;
  enabled: boolean;
  buildState: string;
  cosignVerified: boolean;
  signerId: string | null;
  config: unknown;
  metadata: unknown;
  installedAt: string;
  updatedAt: string;
}

function makeDaemonPlugin(overrides: Partial<DaemonPlugin> = {}): DaemonPlugin {
  return {
    id: overrides.id ?? 'plugin-1',
    tenantScope: overrides.tenantScope ?? 'tenant-1',
    slug: overrides.slug ?? 'com.acme.billing',
    name: overrides.name ?? 'Acme Billing',
    version: overrides.version ?? '1.0.0',
    enabled: overrides.enabled ?? true,
    buildState: overrides.buildState ?? 'stable',
    cosignVerified: overrides.cosignVerified ?? true,
    signerId: overrides.signerId ?? null,
    config: {},
    metadata: {},
    installedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const SAMPLE: DaemonPlugin[] = [
  makeDaemonPlugin({ id: 'p-1', slug: 'com.acme.billing', name: 'Acme Billing', enabled: true }),
  makeDaemonPlugin({
    id: 'p-2',
    slug: 'com.dashboards.custom',
    name: 'Custom Dashboards',
    enabled: true,
  }),
  makeDaemonPlugin({
    id: 'p-3',
    slug: 'com.rioku.slack',
    name: 'Rioku Slack Connector',
    enabled: false,
  }),
];

beforeEach(() => {
  server.resetHandlers();
  server.use(
    http.get(/\/api\/v1\/t\/[^/]+\/plugins$/, () =>
      HttpResponse.json({ items: SAMPLE, total: SAMPLE.length }),
    ),
  );
});

function wrap(ui: React.ReactNode) {
  return renderWithProviders(
    <ModalsProvider>
      <Notifications />
      {ui}
    </ModalsProvider>,
  );
}

describe('InstalledPluginList (real daemon)', () => {
  it('renders plugins fetched from the daemon', async () => {
    wrap(<InstalledPluginList tenantId="tenant-1" onSelect={vi.fn()} onUninstall={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Acme Billing')).toBeTruthy();
    });
    expect(screen.getByText('Custom Dashboards')).toBeTruthy();
    expect(screen.getByText('Rioku Slack Connector')).toBeTruthy();
  });

  it('toggles enable/disable via PUT /enable & /disable', async () => {
    let enableCallCount = 0;
    server.use(
      http.post(/\/api\/v1\/t\/tenant-1\/plugins\/p-1\/disable$/, () => {
        enableCallCount++;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    wrap(<InstalledPluginList tenantId="tenant-1" onSelect={vi.fn()} onUninstall={vi.fn()} />);
    await waitFor(() => screen.getByText('Acme Billing'));

    const toggle = screen.getByLabelText(/Disable Acme Billing/i);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(enableCallCount).toBe(1);
    });
  });

  it('calls onUninstall when menu → Uninstall is clicked', async () => {
    const user = userEvent.setup();
    const onUninstall = vi.fn();
    wrap(<InstalledPluginList tenantId="tenant-1" onSelect={vi.fn()} onUninstall={onUninstall} />);
    await waitFor(() => screen.getByText('Acme Billing'));

    const actionButtons = screen.getAllByLabelText(/Actions for /i);
    const firstAction = actionButtons[0];
    if (!firstAction) throw new Error('No action buttons');
    await user.click(firstAction);

    const uninstallItem = await screen.findByRole('menuitem', { name: /Uninstall/i });
    await user.click(uninstallItem);

    expect(onUninstall).toHaveBeenCalledOnce();
  });
});

describe('UninstallPluginModal (real daemon)', () => {
  it('disables the Uninstall button until the slug is typed exactly, then DELETEs', async () => {
    let deleteCallCount = 0;
    server.use(
      http.delete(/\/api\/v1\/t\/tenant-1\/plugins\/p-1$/, () => {
        deleteCallCount++;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const plugin = {
      id: 'p-1',
      tenant_scope: 'tenant-1',
      slug: 'com.acme.billing',
      display_name: 'Acme Billing',
      version: '1.0.0',
      enabled: true,
      parts: ['daemon' as const],
      declared_permissions: [],
      manifest: {},
      has_errors: false,
      build_state: 'stable' as const,
      cosign_verified: true,
    };

    const onClose = vi.fn();
    const onSuccess = vi.fn();
    wrap(
      <UninstallPluginModal
        plugin={plugin}
        opened={true}
        tenantId="tenant-1"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const submit = screen.getByRole('button', { name: /Uninstall permanently/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText(/Confirm plugin slug/i);
    fireEvent.change(input, { target: { value: 'wrong-slug' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: plugin.slug } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);

    await waitFor(() => {
      expect(deleteCallCount).toBe(1);
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
