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
let injectedNodeId = '__INJECTED_NODE_ID__';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('a', props, children),
  useNavigate: () => mockNavigate,
  useParams: () => ({ tenant: 'acme', nodeId: injectedNodeId }),
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
  injectedNodeId = '__INJECTED_NODE_ID__';
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
  it('renders the heading and four stat cards', () => {
    wrap(<NodesListPage />);
    expect(screen.getByRole('heading', { name: /^cluster nodes$/i })).toBeInTheDocument();
    // Four stat cards — total / healthy / versions / p95.
    expect(screen.getByTestId('stat-total-nodes')).toBeInTheDocument();
    expect(screen.getByTestId('stat-healthy')).toBeInTheDocument();
    expect(screen.getByTestId('stat-version-distribution')).toBeInTheDocument();
    expect(screen.getByTestId('stat-p95-latency')).toBeInTheDocument();
    // Sanity — version distribution renders at least one version entry.
    const versions = screen.getByTestId('stat-version-distribution');
    expect(versions.textContent).toMatch(/0\.\d+\.\d+/);
  });

  it('exposes role="row" on each data row for accessibility', () => {
    wrap(<NodesListPage />);
    const rows = screen.getAllByRole('row');
    // header + 4 seeded data rows
    expect(rows.length).toBe(5);
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
    expect(screen.getByText(/node not found/i)).toBeInTheDocument();
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
  });

  it('renders three tabs (Overview, Metrics, Audit) for an existing node', () => {
    const node = Object.values(useMockStore.getState().clusterNodes).find(
      (n) => n.role === 'primary',
    );
    if (!node) throw new Error('expected a primary seeded node');
    injectedNodeId = node.id;

    wrap(<NodeDetailPage />);

    // Tab list — three tabs.
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /metrics/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /audit/i })).toBeInTheDocument();

    // Default Overview content visible.
    expect(screen.getByText(/Node ID/i)).toBeInTheDocument();
    expect(screen.getByText(node.id)).toBeInTheDocument();
  });

  it('switches to the Metrics tab and renders the PromQL cards', () => {
    const node = Object.values(useMockStore.getState().clusterNodes).find(
      (n) => n.role === 'primary',
    );
    if (!node) throw new Error('expected a primary seeded node');
    injectedNodeId = node.id;

    wrap(<NodeDetailPage />);
    fireEvent.click(screen.getByRole('tab', { name: /metrics/i }));

    expect(screen.getByTestId('node-metric-card-cpu')).toBeInTheDocument();
    expect(screen.getByTestId('node-metric-card-memory')).toBeInTheDocument();
    expect(screen.getByTestId('node-metric-card-rps')).toBeInTheDocument();
    expect(screen.getByTestId('node-metric-card-errors')).toBeInTheDocument();
    expect(screen.getByTestId('node-metric-card-p95')).toBeInTheDocument();
    // PromQL is scoped by instance id.
    const promql = screen.getByTestId('node-metric-promql-cpu');
    expect(promql.textContent).toContain(node.id);
  });

  it('switches to the Audit tab and lists matching cluster audit entries', async () => {
    const removable = Object.values(useMockStore.getState().clusterNodes).find(
      (n) => n.role !== 'primary',
    );
    if (!removable) throw new Error('expected a non-primary seeded node');

    // Generate an audit entry that targets this node.
    const { removeNode } = await import('../api');
    await removeNode(removable.id);

    // Re-seed the node back so the page can render the detail.
    useMockStore.setState((s) => ({
      clusterNodes: { ...s.clusterNodes, [removable.id]: removable },
    }));

    injectedNodeId = removable.id;
    wrap(<NodeDetailPage />);
    fireEvent.click(screen.getByRole('tab', { name: /audit/i }));

    const list = await screen.findByTestId('cluster-node-audit-list');
    expect(list).toBeInTheDocument();
    expect(within(list).getByText(/cluster\.node\.remove/i)).toBeInTheDocument();
  });
});

describe('<EnrollmentTokensPage> consumed-toggle', () => {
  it('hides consumed and expired tokens by default and shows them when toggled', () => {
    wrap(<EnrollmentTokensPage />);

    // Default: only active tokens visible — toggle is off.
    const toggle = screen.getByTestId<HTMLInputElement>('show-consumed-toggle');
    expect(toggle.checked).toBe(false);

    // Default render — at least one row, none are consumed/expired.
    const initialRows = screen.getAllByRole('row');
    const stateBadges = initialRows
      .slice(1)
      .map((r) => r.getAttribute('data-state'))
      .filter((s): s is string => s !== null);
    expect(stateBadges.every((s) => s === 'active')).toBe(true);

    // Toggle on — consumed and expired now visible.
    fireEvent.click(toggle);
    const allRows = screen.getAllByRole('row');
    const allStates = allRows
      .slice(1)
      .map((r) => r.getAttribute('data-state'))
      .filter((s): s is string => s !== null);
    expect(allStates).toContain('consumed');
  });
});
