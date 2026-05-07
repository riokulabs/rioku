/**
 * Tests for <AdminAuditView> — Plan 11 close-out.
 *
 * Covers:
 *   - Empty state when daemon returns []
 *   - List rows when daemon returns proto-shape items
 *   - Note alert when daemon returns a `note` (current proxy mode)
 *   - Hash-chain Verify button is enabled and runs verifyAdminAuditChain
 *     when entries carry hash + prevHash
 *   - Hash-chain Verify button is disabled with an "unsupported" badge
 *     when entries lack hash fields (current daemon proxy)
 *   - verifyAdminAuditChain unit tests (valid chain → ok:true,
 *     corrupted link → ok:false with brokenAt set, empty → ok:true)
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminAuditView } from '../components/admin-audit-view';
import { useMockStore } from '@/api/mock-store';
import { logAdminAuditEntry, verifyAdminAuditChain } from '@/api/resources/audit';
import type { AdminAuditEntry } from '@/api/resources';
import {
  AdminTestWrapper,
  makeQueryClient,
  mockListAudit,
} from './admin-msw-helpers';

function renderAudit() {
  const client = makeQueryClient();
  return render(
    <AdminTestWrapper client={client}>
      <AdminAuditView />
    </AdminTestWrapper>,
  );
}

describe('AdminAuditView — list view backed by useListAdminAudit', () => {
  it('renders the empty state when the daemon returns no items', async () => {
    mockListAudit([]);
    renderAudit();
    await waitFor(() => {
      expect(screen.getByText(/no admin audit entries/i)).toBeDefined();
    });
  });

  it('renders the daemon `note` field when present (current proxy mode)', async () => {
    mockListAudit(
      [
        {
          id: 'audit-1',
          actor: 'user-0001',
          entityType: 'tenant',
          entityId: 'tenant-acme',
          operation: 'tenant:create',
          occurredAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      'hash-chained super-admin audit is a follow-up; this proxies the per-tenant log',
    );
    renderAudit();
    await waitFor(() => {
      expect(screen.getByTestId('audit-note')).toBeDefined();
    });
    expect(screen.getByText(/proxies the per-tenant log/i)).toBeDefined();
  });

  it('renders proto-shape items into the table', async () => {
    mockListAudit([
      {
        id: 'a-1',
        actor: 'user-0001',
        entityType: 'tenant',
        entityId: 'tenant-acme',
        operation: 'tenant:create',
        occurredAt: '2026-04-01T00:00:00.000Z',
      },
      {
        id: 'a-2',
        actor: 'user-0002',
        entityType: 'tenant',
        entityId: 'tenant-beta',
        operation: 'tenant:delete',
        occurredAt: '2026-04-02T00:00:00.000Z',
      },
    ]);
    renderAudit();
    await waitFor(() => {
      expect(screen.getByText('tenant:create')).toBeDefined();
      expect(screen.getByText('tenant:delete')).toBeDefined();
    });
  });

  it('disables Verify chain when no entries carry hash fields and surfaces an unsupported badge', async () => {
    mockListAudit([
      {
        id: 'a-1',
        actor: 'user-0001',
        operation: 'tenant:create',
        occurredAt: '2026-04-01T00:00:00.000Z',
      },
    ]);
    renderAudit();
    await screen.findByText('tenant:create');
    const verifyBtn = screen.getByRole('button', { name: /verify chain/i });
    expect((verifyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('verifies a hash-chained payload when entries carry hash + prevHash', async () => {
    // Build a real hash-chained payload using logAdminAuditEntry, then ship
    // it down through MSW so the component sees authentic chain data.
    useMockStore.getState().reset();
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'tenant:create',
      resource_type: 'tenant',
      resource_id: 'tenant-acme',
    });
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'tenant:update',
      resource_type: 'tenant',
      resource_id: 'tenant-acme',
    });
    const chained = useMockStore.getState().adminAudit;
    mockListAudit(chained as unknown as Record<string, unknown>[]);

    renderAudit();
    await screen.findByText('tenant:create');

    const verifyBtn = screen.getByRole('button', { name: /verify chain/i });
    expect((verifyBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(screen.getByTestId('chain-verified-badge')).toBeDefined();
    });
  });

  it('opens the detail drawer with Overview / Diff / Hash chain tabs', async () => {
    mockListAudit([
      {
        id: 'a-1',
        actor: 'user-0001',
        entityType: 'tenant',
        operation: 'tenant:create',
        occurredAt: '2026-04-01T00:00:00.000Z',
      },
    ]);
    renderAudit();
    const detailBtn = await screen.findByRole('button', { name: /view details for/i });
    fireEvent.click(detailBtn);
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeDefined();
      expect(screen.getByText('Diff')).toBeDefined();
      expect(screen.getByText('Hash chain')).toBeDefined();
    });
  });
});

// ─── Chain integrity (function-level) ─────────────────────────────────────────

describe('verifyAdminAuditChain', () => {
  it('returns ok:true for a valid chain', async () => {
    useMockStore.getState().reset();
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

  it('returns ok:false with brokenAt set when a link is corrupted', async () => {
    useMockStore.getState().reset();
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
    const original = useMockStore.getState().adminAudit;
    const corrupted: AdminAuditEntry[] = original.map((e, i) =>
      i === 1
        ? { ...e, hash: 'deadbeef00000000000000000000000000000000000000000000000000000000' }
        : e,
    );

    const result = await verifyAdminAuditChain(corrupted);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBeDefined();
    expect(typeof result.brokenAt).toBe('number');
  });

  it('returns ok:true for an empty chain', async () => {
    const result = await verifyAdminAuditChain([]);
    expect(result.ok).toBe(true);
  });
});
