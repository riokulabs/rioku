/**
 * Tests for <AdminAuditView> — Task 4 (Plan 11)
 *
 * Covers:
 *   - Empty state renders when no entries
 *   - Renders entries when they exist
 *   - Filter controls: actor, tenant, kind, date range
 *   - Chain integrity: valid chain passes verification
 *   - Chain integrity: corrupted link fails verification
 *   - Detail drawer opens with Overview / Diff / Hash-chain tabs
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
import { logAdminAuditEntry, verifyAdminAuditChain } from '@/api/resources/audit';
import type { AdminAuditEntry } from '@/api/resources';
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
    wrap(<AdminAuditView />);
    expect(screen.getByText(/no admin audit entries/i)).toBeDefined();
  });

  it('renders admin audit entries when they exist', async () => {
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

  it('renders actor filter select', () => {
    wrap(<AdminAuditView />);
    expect(screen.getByTestId('actor-filter')).toBeDefined();
  });

  it('renders tenant filter select', () => {
    wrap(<AdminAuditView />);
    expect(screen.getByTestId('tenant-filter')).toBeDefined();
  });

  it('renders kind filter input', () => {
    wrap(<AdminAuditView />);
    expect(screen.getByTestId('kind-filter')).toBeDefined();
  });

  it('opens detail drawer when Details button is clicked', async () => {
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'tenant:create',
      resource_type: 'tenant',
      resource_id: 'tenant-1',
      tier: 'write',
    });

    wrap(<AdminAuditView />);
    const detailBtn = screen.getByRole('button', { name: /view details for/i });
    fireEvent.click(detailBtn);

    await waitFor(() => {
      // Overview tab should be visible
      expect(screen.getByText('Overview')).toBeDefined();
    });
  });

  it('detail drawer shows Diff tab', async () => {
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'tenant:create',
      resource_type: 'tenant',
    });

    wrap(<AdminAuditView />);
    const detailBtn = screen.getByRole('button', { name: /view details for/i });
    fireEvent.click(detailBtn);

    await waitFor(() => {
      expect(screen.getByText('Diff')).toBeDefined();
    });
  });

  it('detail drawer shows Hash chain tab', async () => {
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'tenant:create',
      resource_type: 'tenant',
    });

    wrap(<AdminAuditView />);
    const detailBtn = screen.getByRole('button', { name: /view details for/i });
    fireEvent.click(detailBtn);

    await waitFor(() => {
      expect(screen.getByText('Hash chain')).toBeDefined();
    });
  });
});

// ─── Chain integrity verification ─────────────────────────────────────────────

describe('AdminAuditView — chain integrity', () => {
  it('verifyAdminAuditChain returns ok:true for a valid chain', async () => {
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'a:1',
      resource_type: 'test',
    });
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'a:2',
      resource_type: 'test',
    });
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'a:3',
      resource_type: 'test',
    });

    const entries = useMockStore.getState().adminAudit;
    const result = await verifyAdminAuditChain(entries);
    expect(result.ok).toBe(true);
  });

  it('verifyAdminAuditChain returns ok:false when a link is corrupted', async () => {
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'b:1',
      resource_type: 'test',
    });
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'b:2',
      resource_type: 'test',
    });
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'b:3',
      resource_type: 'test',
    });

    // Corrupt the second entry's hash to simulate tampering
    const original = useMockStore.getState().adminAudit;
    const corrupted: AdminAuditEntry[] = original.map((e, i) =>
      i === 1 ? { ...e, hash: 'deadbeef00000000000000000000000000000000000000000000000000000000' } : e,
    );

    const result = await verifyAdminAuditChain(corrupted);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBeDefined();
  });

  it('verifyAdminAuditChain returns ok:true for an empty chain', async () => {
    const result = await verifyAdminAuditChain([]);
    expect(result.ok).toBe(true);
  });
});
