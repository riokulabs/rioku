/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * <VersionHistoryDrawer> tests — list render, selection, diff, restore flow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { Dashboard } from '@/api/resources/types';
import { VersionHistoryDrawer } from '../components/version-history-drawer';
import { snapshotDashboard } from '../api';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

function firstDashboard(): Dashboard {
  const ds = Object.values(useMockStore.getState().dashboards);
  if (ds.length === 0) throw new Error('no dashboards seeded');
  return ds[0]!;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('<VersionHistoryDrawer>', () => {
  it('renders the list of versions', async () => {
    const dashboard = firstDashboard();
    wrap(<VersionHistoryDrawer opened dashboard={dashboard} onClose={vi.fn()} />);
    expect(await screen.findByTestId('version-history-drawer')).toBeTruthy();
    // Seeded dashboard has at least one version.
    const versions = Object.values(useMockStore.getState().dashboardVersions).filter(
      (v) => v.dashboard_id === dashboard.id,
    );
    expect(versions.length).toBeGreaterThan(0);
  });

  it('selecting a single version shows a Restore button', async () => {
    const user = userEvent.setup();
    const dashboard = firstDashboard();
    wrap(<VersionHistoryDrawer opened dashboard={dashboard} onClose={vi.fn()} />);

    // Click the first version row — version numbers are desc-sorted so pick
    // the first dom match.
    const firstRow = (await screen.findAllByTestId(/^version-history-row-/))[0]!;
    await user.click(firstRow);
    expect(await screen.findByTestId('version-history-restore')).toBeTruthy();
    expect(screen.getByTestId('version-history-snapshot')).toBeTruthy();
  });

  it('selecting two versions renders the diff grid', async () => {
    const user = userEvent.setup();
    const dashboard = firstDashboard();
    // Ensure at least 2 versions exist.
    await snapshotDashboard(dashboard.id, 'extra snap for diff');
    wrap(<VersionHistoryDrawer opened dashboard={dashboard} onClose={vi.fn()} />);

    const rows = await screen.findAllByTestId(/^version-history-row-/);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await user.click(rows[0]!);
    await user.click(rows[1]!);
    expect(await screen.findByTestId('version-history-diff')).toBeTruthy();
  });

  it('restore flow requires typing "restore" then fires onRestored', async () => {
    const user = userEvent.setup();
    const dashboard = firstDashboard();
    const onRestored = vi.fn();
    wrap(
      <VersionHistoryDrawer
        opened
        dashboard={dashboard}
        onClose={vi.fn()}
        onRestored={onRestored}
      />,
    );

    const row = (await screen.findAllByTestId(/^version-history-row-/))[0]!;
    await user.click(row);
    await user.click(await screen.findByTestId('version-history-restore'));

    const confirmInput = await screen.findByTestId('version-history-restore-confirm');
    const restoreBtn = screen.getByTestId<HTMLButtonElement>('version-history-restore-confirm-btn');
    expect(restoreBtn.disabled).toBe(true);
    await user.type(confirmInput, 'restore');
    expect(restoreBtn.disabled).toBe(false);
    await user.click(restoreBtn);

    await waitFor(
      () => {
        expect(onRestored).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});
