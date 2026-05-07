 
/**
 * <AskQuestionWizard> — happy-path test through all 4 steps.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { AskQuestionWizard } from '../components/ask-question-wizard';

function firstAcmeDashboardId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
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

describe('<AskQuestionWizard>', () => {
  it('walks through all 4 steps and saves a widget', async () => {
    const user = userEvent.setup();
    const dashId = firstAcmeDashboardId();
    const onSave = vi.fn();
    const onCancel = vi.fn();

    wrap(
      <AskQuestionWizard dashboardId={dashId} mode="create" onSave={onSave} onCancel={onCancel} />,
    );

    // Step 1: pick data source
    await user.click(await screen.findByTestId('source-mock'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2: pick visualization
    await user.click(await screen.findByTestId('viz-single-stat'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 3: fill title (required)
    const title = await screen.findByTestId('wizard-title');
    await user.type(title, 'Traffic today');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 4: save
    await user.click(await screen.findByTestId('wizard-save'));

    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    const savedWidget = onSave.mock.calls[0]![0] as {
      title: string;
      kind: string;
      data_source: string;
    };
    expect(savedWidget.title).toBe('Traffic today');
    expect(savedWidget.kind).toBe('single-stat');
    expect(savedWidget.data_source).toBe('mock');
  });

  it('blocks Next until required fields are provided', async () => {
    const user = userEvent.setup();
    const dashId = firstAcmeDashboardId();
    wrap(
      <AskQuestionWizard dashboardId={dashId} mode="create" onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    // No source selected → Next surfaces an error alert.
    await user.click(await screen.findByRole('button', { name: /Next/ }));
    expect(screen.getByText(/Pick a data source/)).toBeTruthy();
  });
});
