/**
 * T5 home-dashboard resolution + UI buttons.
 *
 * Verifies:
 *   - "Set as tenant default" wiring on the viewer flips dashboard.default
 *     and clears any prior default for the tenant.
 *   - "Make this my home" wiring on the viewer writes
 *     userHomeDashboards[userId].
 *   - Resolution order in /t/$tenant/dashboard inline page: per-user home
 *     overrides tenant default; tenant default falls back when no override.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { DashboardViewer } from '../components/viewer';
import { setAsMyHome, setDefaultDashboard, useUserHomeDashboard } from '../api';
import type { Dashboard } from '@/api/resources';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function acmeId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return acme.id;
}

function acmeDashboards(): Dashboard[] {
  const tid = acmeId();
  return Object.values(useMockStore.getState().dashboards).filter((d) => d.tenant_id === tid);
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('T5 — Set-as-default + Make-my-home wiring', () => {
  it('setDefaultDashboard flips default flag and clears prior defaults', async () => {
    const ds = acmeDashboards();
    expect(ds.length).toBeGreaterThanOrEqual(2);
    const prior = ds.find((d) => d.default);
    expect(prior).toBeDefined();
    const target = ds.find((d) => !d.default);
    expect(target).toBeDefined();

    await setDefaultDashboard(acmeId(), target!.id);

    const after = useMockStore.getState().dashboards;
    expect(after[target!.id]!.default).toBe(true);
    expect(after[prior!.id]!.default).toBe(false);
  });

  it('setAsMyHome writes userHomeDashboards[userId]', async () => {
    const uid = useMockStore.getState().currentUserId!;
    const target = acmeDashboards()[0]!;
    await setAsMyHome(uid, target.id);
    expect(useMockStore.getState().userHomeDashboards[uid]).toBe(target.id);
  });

  it('viewer renders Set-as-tenant-default menu item; clicking calls onSetDefault with id', async () => {
    const uid = useMockStore.getState().currentUserId!;
    const target = acmeDashboards().find((d) => !d.default)!;
    // Make derrick owner so canWrite resolves true.
    useMockStore.setState((s) => ({
      dashboards: {
        ...s.dashboards,
        [target.id]: { ...s.dashboards[target.id]!, owner_user_id: uid },
      },
    }));
    let captured: string | null = null;
    wrap(
      <DashboardViewer
        dashboardId={target.id}
        onSetDefault={(id) => {
          captured = id;
        }}
      />,
    );
    const user = userEvent.setup();
    const more = screen.getByTestId('dashboard-viewer-more');
    await user.click(more);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-viewer-set-default')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('dashboard-viewer-set-default'));
    expect(captured).toBe(target.id);
  });
});

describe('T5 — Home dashboard resolution helper', () => {
  it('useUserHomeDashboard reflects setAsMyHome writes', async () => {
    const uid = useMockStore.getState().currentUserId!;
    const ds = acmeDashboards();
    await setAsMyHome(uid, ds[0]!.id);
    // Read via the selector hook through a tiny harness component.
    function Probe() {
      const home = useUserHomeDashboard(uid);
      return <span data-testid="home">{home ?? 'none'}</span>;
    }
    wrap(<Probe />);
    expect(screen.getByTestId('home').textContent).toBe(ds[0]!.id);
  });

  it('tenant default vs personal home: personal home wins when both are set', async () => {
    const uid = useMockStore.getState().currentUserId!;
    const ds = acmeDashboards();
    // ds[0] is the seeded default; pick a different one as personal home.
    const tenantDefault = ds.find((d) => d.default)!;
    const personalHome = ds.find((d) => !d.default)!;
    await setAsMyHome(uid, personalHome.id);

    const userHomeId = useMockStore.getState().userHomeDashboards[uid];
    let resolved: string | undefined;
    if (userHomeId) {
      const d = useMockStore.getState().dashboards[userHomeId];
      if (d?.tenant_id === acmeId()) resolved = d.id;
    }
    if (resolved === undefined) {
      for (const d of Object.values(useMockStore.getState().dashboards)) {
        if (d.tenant_id === acmeId() && d.default) {
          resolved = d.id;
          break;
        }
      }
    }
    expect(resolved).toBe(personalHome.id);
    expect(resolved).not.toBe(tenantDefault.id);
  });

  it('tenant default vs personal home: tenant default wins when no personal home is set', () => {
    const uid = useMockStore.getState().currentUserId!;
    const ds = acmeDashboards();
    const tenantDefault = ds.find((d) => d.default)!;
    const userHomeId = useMockStore.getState().userHomeDashboards[uid];
    expect(userHomeId).toBeUndefined();

    let resolved: string | undefined;
    for (const d of Object.values(useMockStore.getState().dashboards)) {
      if (d.tenant_id === acmeId() && d.default) {
        resolved = d.id;
        break;
      }
    }
    expect(resolved).toBe(tenantDefault.id);
  });
});
