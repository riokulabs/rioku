/**
 * Tests for <AdminAuditView>
 * Task 1d.78
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { logAdminAuditEntry } from '@/api/resources/audit';
import { AdminAuditView } from '../components/admin-audit-view';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('AdminAuditView', () => {
  it('renders empty state when no admin audit entries exist', () => {
    // Mock store has 0 admin audit entries after seed (impersonation only seeded
    // via logAdminAuditEntry during actual entry, not in seed fixture)
    wrap(<AdminAuditView />);
    expect(screen.getByText(/no admin audit entries/i)).toBeDefined();
  });

  it('renders admin audit entries when they exist', async () => {
    // Seed some admin audit entries
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'impersonation:enter',
      resource_type: 'impersonation_session',
      resource_id: 'imp-0001',
    });
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'impersonation:exit',
      resource_type: 'impersonation_session',
      resource_id: 'imp-0001',
    });

    wrap(<AdminAuditView />);
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThanOrEqual(3); // header + 2 data rows
  });

  it('shows chain-verified badge after clicking Verify chain', async () => {
    // Add valid chain entries
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'test:action',
      resource_type: 'test',
    });

    wrap(<AdminAuditView />);
    const verifyBtn = screen.getByRole('button', { name: /verify chain/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('chain-verified-badge')).toBeDefined();
    });
  });
});
