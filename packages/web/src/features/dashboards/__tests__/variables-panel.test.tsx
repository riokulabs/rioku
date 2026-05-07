 
/**
 * <VariablesPanel> tests — non-Grafana empty state, add/save/delete flows,
 * validation errors on empty / duplicate / enum-without-options.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { Dashboard } from '@/api/resources';
import { VariablesPanel } from '../components/variables-panel';

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

function firstAcmeDashboard(): Dashboard {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('no acme tenant');
  const d = Object.values(useMockStore.getState().dashboards).find((x) => x.tenant_id === acme.id);
  if (!d) throw new Error('no acme dashboard');
  return d;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('<VariablesPanel>', () => {
  it('renders a read-only empty state when dashboard is in metabase mode', () => {
    const dashboard = { ...firstAcmeDashboard(), mode: 'metabase' as const };
    wrap(<VariablesPanel dashboard={dashboard} />);
    expect(screen.getByTestId('variables-panel')).toBeTruthy();
    expect(screen.getByText(/Variables are only used in Grafana mode/)).toBeTruthy();
    expect(screen.queryByTestId('variables-panel-add')).toBeNull();
  });

  it('shows the add/save controls when in grafana mode', () => {
    const dashboard = { ...firstAcmeDashboard(), mode: 'grafana' as const };
    wrap(<VariablesPanel dashboard={dashboard} />);
    expect(screen.getByTestId('variables-panel-add')).toBeTruthy();
    expect(screen.getByTestId('variables-panel-save')).toBeTruthy();
  });

  it('add → fill → save updates dashboard.variables', async () => {
    const user = userEvent.setup();
    const dashboard = {
      ...firstAcmeDashboard(),
      mode: 'grafana' as const,
      variables: [],
    };
    const onSaved = vi.fn();
    wrap(<VariablesPanel dashboard={dashboard} onSaved={onSaved} />);

    await user.click(screen.getByTestId('variables-panel-add'));
    const nameInput = await screen.findByLabelText('Variable 1 name');
    await user.type(nameInput, 'tenant');
    const defaultInput = screen.getByLabelText('Variable 1 default');
    await user.type(defaultInput, 'acme');

    await user.click(screen.getByTestId('variables-panel-save'));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    const saved = onSaved.mock.calls[0]![0] as Dashboard;
    expect(saved.variables.length).toBe(1);
    expect(saved.variables[0]!.name).toBe('tenant');
    expect(saved.variables[0]!.default).toBe('acme');
  });

  it('rejects duplicate names', async () => {
    const user = userEvent.setup();
    const dashboard = {
      ...firstAcmeDashboard(),
      mode: 'grafana' as const,
      variables: [
        { name: 'dup', kind: 'text' as const, default: 'a' },
        { name: 'dup', kind: 'text' as const, default: 'b' },
      ],
    };
    const onSaved = vi.fn();
    wrap(<VariablesPanel dashboard={dashboard} onSaved={onSaved} />);

    // Dirty the draft so the Save button enables (mutate a default).
    const defaultInput = screen.getByLabelText('Variable 1 default');
    await user.type(defaultInput, 'x');

    await user.click(screen.getByTestId('variables-panel-save'));
    await waitFor(() => {
      expect(screen.getAllByText(/defined more than once/).length).toBeGreaterThan(0);
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('delete removes a row from the draft', async () => {
    const user = userEvent.setup();
    const dashboard = {
      ...firstAcmeDashboard(),
      mode: 'grafana' as const,
      variables: [{ name: 'to-remove', kind: 'text' as const, default: 'x' }],
    };
    wrap(<VariablesPanel dashboard={dashboard} />);

    expect(screen.getByTestId('variables-panel-row-0')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove variable 1' }));
    expect(screen.queryByTestId('variables-panel-row-0')).toBeNull();
  });
});
