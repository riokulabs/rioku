/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * <DashboardBuilderShell> tests — render + save flow + dirty cancel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { DashboardBuilderShell } from '../components/builder-shell';

function firstAcmeDashboardId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find(
    (t) => t.slug === 'acme',
  );
  if (!acme) throw new Error('No acme tenant seeded');
  const dashboards = Object.values(useMockStore.getState().dashboards).filter(
    (d) => d.tenant_id === acme.id,
  );
  if (dashboards.length === 0) throw new Error('No acme dashboard seeded');
  return dashboards[0]!.id;
}

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  const derrick = Object.values(useMockStore.getState().users).find(
    (u) => u.email === 'derrick@acme.com',
  );
  useMockStore.setState({ currentUserId: derrick?.id ?? 'user-0000' });
});

describe('<DashboardBuilderShell>', () => {
  it('renders top bar, palette, and grid canvas', async () => {
    const dashId = firstAcmeDashboardId();
    const onDone = vi.fn();
    wrap(<DashboardBuilderShell dashboardId={dashId} onDone={onDone} />);
    expect(await screen.findByTestId('dashboard-builder-shell')).toBeTruthy();
    expect(screen.getByLabelText('Dashboard name')).toBeTruthy();
    expect(screen.getAllByLabelText('Widget palette').length).toBeGreaterThan(0);
    expect(screen.getByTestId('grid-canvas')).toBeTruthy();
  });

  it('shows dashboard-not-found alert for unknown id', () => {
    const onDone = vi.fn();
    wrap(<DashboardBuilderShell dashboardId="does-not-exist" onDone={onDone} />);
    expect(screen.getByText(/Dashboard not found/)).toBeTruthy();
  });

  it('cancel calls onDone when clean', async () => {
    const user = userEvent.setup();
    const dashId = firstAcmeDashboardId();
    const onDone = vi.fn();
    wrap(<DashboardBuilderShell dashboardId={dashId} onDone={onDone} />);
    await user.click(await screen.findByRole('button', { name: /Cancel/ }));
    expect(onDone).toHaveBeenCalledWith('cancelled');
  });

  it('save snapshots + updates + calls onDone("saved")', async () => {
    const user = userEvent.setup();
    const dashId = firstAcmeDashboardId();
    const onDone = vi.fn();
    const versionsBefore = Object.values(
      useMockStore.getState().dashboardVersions,
    ).filter((v) => v.dashboard_id === dashId).length;

    wrap(<DashboardBuilderShell dashboardId={dashId} onDone={onDone} />);
    await user.click(await screen.findByTestId('builder-save'));

    await vi.waitFor(
      () => {
        expect(onDone).toHaveBeenCalledWith('saved');
      },
      { timeout: 3000 },
    );
    const versionsAfter = Object.values(
      useMockStore.getState().dashboardVersions,
    ).filter((v) => v.dashboard_id === dashId).length;
    expect(versionsAfter).toBe(versionsBefore + 1);
  });

  it('cancel with dirty changes shows confirm modal', async () => {
    const user = userEvent.setup();
    const dashId = firstAcmeDashboardId();
    const onDone = vi.fn();
    wrap(<DashboardBuilderShell dashboardId={dashId} onDone={onDone} />);

    // Rename to dirty the form.
    const nameInput = await screen.findByLabelText('Dashboard name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed dashboard');

    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    // Confirm modal appears.
    expect(screen.getAllByText(/Discard changes\?/).length).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();

    // Clicking Discard triggers onDone('cancelled').
    await user.click(screen.getByRole('button', { name: /^Discard$/ }));
    expect(onDone).toHaveBeenCalledWith('cancelled');
  });
});
