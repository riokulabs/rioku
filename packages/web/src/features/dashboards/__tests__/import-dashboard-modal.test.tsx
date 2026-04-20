/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * <ImportDashboardModal> tests — tab switching, validation error paths, and
 * the happy-path paste+import flow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { Dashboard } from '@/api/resources/types';
import { ImportDashboardModal } from '../components/import-dashboard-modal';
import { exportDashboardJson } from '../api';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

function firstAcmeDashboardId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find(
    (t) => t.slug === 'acme',
  );
  if (!acme) throw new Error('no acme tenant');
  const d = Object.values(useMockStore.getState().dashboards).find(
    (x) => x.tenant_id === acme.id,
  );
  if (!d) throw new Error('no acme dashboard');
  return d.id;
}

function acmeTenantId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find(
    (t) => t.slug === 'acme',
  );
  if (!acme) throw new Error('no acme tenant');
  return acme.id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('<ImportDashboardModal>', () => {
  it('renders the paste / upload tabs', async () => {
    wrap(
      <ImportDashboardModal
        opened
        tenantId={acmeTenantId()}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('import-dashboard-modal')).toBeTruthy();
    expect(screen.getByTestId('import-tab-paste')).toBeTruthy();
    expect(screen.getByTestId('import-tab-upload')).toBeTruthy();
  });

  it('empty paste shows an inline validation error', async () => {
    const user = userEvent.setup();
    wrap(
      <ImportDashboardModal
        opened
        tenantId={acmeTenantId()}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    await user.click(await screen.findByTestId('import-dashboard-confirm'));
    expect(await screen.findByTestId('import-error')).toBeTruthy();
  });

  it('invalid JSON surfaces a parse error', async () => {
    const user = userEvent.setup();
    wrap(
      <ImportDashboardModal
        opened
        tenantId={acmeTenantId()}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    const textarea = await screen.findByTestId('import-json-textarea');
    await user.type(textarea, 'not-json');
    await user.click(screen.getByTestId('import-dashboard-confirm'));
    const err = await screen.findByTestId('import-error');
    expect(err.textContent).toMatch(/Invalid/i);
  });

  it('valid paste triggers onImported with the new dashboard', async () => {
    const user = userEvent.setup();
    const sourceId = firstAcmeDashboardId();
    const payload = exportDashboardJson(sourceId);
    const serialized = JSON.stringify(payload);

    const onImported = vi.fn();
    wrap(
      <ImportDashboardModal
        opened
        tenantId={acmeTenantId()}
        onClose={vi.fn()}
        onImported={onImported}
      />,
    );
    const textarea = await screen.findByTestId('import-json-textarea');
    // Avoid userEvent's keyboard escapes by setting value directly.
    await user.click(textarea);
    await user.paste(serialized);
    await user.click(screen.getByTestId('import-dashboard-confirm'));

    await waitFor(
      () => {
        expect(onImported).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
    const imported = onImported.mock.calls[0]![0] as Dashboard;
    expect(imported.id).not.toBe(sourceId);
  });
});
