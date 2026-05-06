/**
 * Tests for <NodesListPage> + <EnrollmentTokensPage> + <NodeDetailPage>.
 *
 * Stage-2 Plan 10: ensures the focused subroutes render their seeded
 * data, surface stat cards, gate destructive actions on permissions, and
 * fire the right mutations against the mock store.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('a', props, children),
  useNavigate: () => mockNavigate,
  useParams: () => ({ tenant: 'acme', nodeId: '__INJECTED_NODE_ID__' }),
  useRouter: () => ({ navigate: mockNavigate }),
}));

import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { NodesListPage } from '../components/nodes-list-page';
import { EnrollmentTokensPage } from '../components/enrollment-tokens-page';
import { NodeDetailPage } from '../components/node-detail-page';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  useMockStore.getState().reset();
  seedStore(useMockStore);
  // Mock root user so all permission gates open.
  const state = useMockStore.getState();
  const rootUser = Object.values(state.users).find((u) => u.email.includes('root'));
  if (rootUser) {
    useMockStore.setState({ currentUserId: rootUser.id });
  }
});

describe('<NodesListPage>', () => {
  it('renders the heading and stat cards', () => {
    wrap(<NodesListPage />);
    expect(screen.getByRole('heading', { name: /^cluster nodes$/i })).toBeInTheDocument();
    expect(screen.getByText(/total nodes/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^healthy$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^unhealthy$/i)).toBeInTheDocument();
  });

  it('renders one row per seeded cluster node', () => {
    const seedCount = Object.keys(useMockStore.getState().clusterNodes).length;
    expect(seedCount).toBeGreaterThanOrEqual(4);
    wrap(<NodesListPage />);
    const rows = screen.getAllByRole('row');
    // header + N data rows
    expect(rows.length - 1).toBe(seedCount);
  });

  it('shows the Enroll node button when permitted', () => {
    wrap(<NodesListPage />);
    expect(screen.getByRole('button', { name: /enroll node/i })).toBeInTheDocument();
  });

  it('removes a non-primary node when the row Remove action is confirmed', async () => {
    const removable = Object.values(useMockStore.getState().clusterNodes).find(
      (n) => n.role !== 'primary',
    );
    if (!removable) throw new Error('expected a non-primary seeded node');

    wrap(<NodesListPage />);
    // Each non-primary row exposes a "Remove node" action button.
    const removeButtons = screen.getAllByLabelText(/remove node/i);
    expect(removeButtons.length).toBeGreaterThan(0);
    const firstRemove = removeButtons[0];
    if (!firstRemove) throw new Error('expected a remove button');
    fireEvent.click(firstRemove);

    // Confirm modal appears
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^remove$/i }));

    await waitFor(() => {
      expect(
        Object.keys(useMockStore.getState().clusterNodes).length,
      ).toBeLessThan(4);
    });
    expect(useMockStore.getState().audit.at(-1)?.action).toBe('cluster.node.remove');
  });
});

describe('<EnrollmentTokensPage>', () => {
  it('renders the heading and at least one seeded token', () => {
    wrap(<EnrollmentTokensPage />);
    expect(screen.getByRole('heading', { name: /^enrollment tokens$/i })).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('shows the Generate token button when permitted', () => {
    wrap(<EnrollmentTokensPage />);
    expect(screen.getByRole('button', { name: /generate token/i })).toBeInTheDocument();
  });

  it('revokes an active token via the row action and appends a destructive audit', async () => {
    const before = Object.keys(useMockStore.getState().clusterEnrollmentTokens).length;
    expect(before).toBeGreaterThan(0);

    wrap(<EnrollmentTokensPage />);

    const revokeButtons = screen.getAllByLabelText(/revoke enrollment token/i);
    expect(revokeButtons.length).toBeGreaterThan(0);
    const firstRevoke = revokeButtons[0];
    if (!firstRevoke) throw new Error('expected a revoke button');
    fireEvent.click(firstRevoke);

    await waitFor(() => {
      const after = Object.keys(useMockStore.getState().clusterEnrollmentTokens).length;
      expect(after).toBe(before - 1);
    });
    const last = useMockStore.getState().audit.at(-1);
    expect(last?.action).toBe('cluster.enrollment_token.revoke');
    expect(last?.tier).toBe('destructive');
  });
});

describe('<NodeDetailPage>', () => {
  it('renders an alert when the node id is unknown', () => {
    wrap(<NodeDetailPage />);
    // Our mock useParams returns __INJECTED_NODE_ID__ which never exists.
    expect(screen.getByText(/node not found/i)).toBeInTheDocument();
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
  });
});
