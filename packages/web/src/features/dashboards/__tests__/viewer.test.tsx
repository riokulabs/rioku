 
/**
 * <DashboardViewer> smoke tests — happy path (renders widgets), empty state
 * (no widgets), missing dashboard (not-found state).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { DashboardViewer } from '../components/viewer';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function acmeTenantId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return acme.id;
}

function firstAcmeDashboardId(): string {
  const tid = acmeTenantId();
  const dashboards = Object.values(useMockStore.getState().dashboards).filter(
    (d) => d.tenant_id === tid,
  );
  if (dashboards.length === 0) throw new Error('No acme dashboard seeded');
  return dashboards[0]!.id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  // seedStore sets currentUserId + currentTenantId (derrick + acme).
});

describe('<DashboardViewer>', () => {
  it('renders the dashboard header and widgets', () => {
    const id = firstAcmeDashboardId();
    const dashboard = useMockStore.getState().dashboards[id]!;
    wrap(<DashboardViewer dashboardId={id} />);
    expect(screen.getByText(dashboard.name)).toBeInTheDocument();
    // mode badge
    expect(screen.getByText(new RegExp(dashboard.mode, 'i'))).toBeInTheDocument();
  });

  it('renders an empty state when the dashboard has no widgets', () => {
    const id = firstAcmeDashboardId();
    useMockStore.setState((s) => ({
      dashboards: {
        ...s.dashboards,
        [id]: { ...s.dashboards[id]!, widget_ids: [] },
      },
    }));
    wrap(<DashboardViewer dashboardId={id} />);
    expect(screen.getByText('No widgets yet')).toBeInTheDocument();
  });

  it('renders the not-found state for a missing dashboard', () => {
    wrap(<DashboardViewer dashboardId="does-not-exist" />);
    expect(screen.getByText('Dashboard not found')).toBeInTheDocument();
  });

  it('invokes onEdit when the Edit button is clicked', async () => {
    const id = firstAcmeDashboardId();
    // Ensure derrick has dashboard:write — which he does by default (admin role).
    const onEdit = vi.fn();
    const user = (await import('@testing-library/user-event')).default.setup();
    wrap(<DashboardViewer dashboardId={id} onEdit={onEdit} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(id);
  });
});
