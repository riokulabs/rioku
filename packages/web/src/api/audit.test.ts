/**
 * Tests for hash-chained super-admin audit log.
 * spec §8.2 / Task 1d.77
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from './mock-store';
import { logAuditEntry, logAdminAuditEntry, verifyAdminAuditChain } from './resources/audit';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetStore() {
  useMockStore.getState().reset();
}

const baseInput = {
  tenant_id: 'tenant-0001',
  actor_id: 'user-0001',
  action: 'impersonation:enter',
  resource_type: 'impersonation_session',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('logAuditEntry (tenant-side)', () => {
  beforeEach(resetStore);

  it('appends an entry to the tenant audit log', () => {
    logAuditEntry(baseInput);
    const { audit } = useMockStore.getState();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('impersonation:enter');
    expect(audit[0]?.actor_id).toBe('user-0001');
  });

  it('sets acted_as_admin when provided', () => {
    logAuditEntry({ ...baseInput, acted_as_admin: true });
    const { audit } = useMockStore.getState();
    expect(audit[0]?.acted_as_admin).toBe(true);
  });

  it('threads impersonation_session_id through', () => {
    logAuditEntry({ ...baseInput, impersonation_session_id: 'imp-0001' });
    const { audit } = useMockStore.getState();
    expect(audit[0]?.impersonation_session_id).toBe('imp-0001');
  });
});

describe('logAdminAuditEntry (hash-chained)', () => {
  beforeEach(resetStore);

  it('writes to adminAudit with hash and prev_hash', async () => {
    await logAdminAuditEntry(baseInput);
    const { adminAudit } = useMockStore.getState();
    expect(adminAudit).toHaveLength(1);
    expect(adminAudit[0]?.kind).toBe('admin');
    expect(adminAudit[0]?.prev_hash).toBe('');
    expect(adminAudit[0]?.hash).toBeTruthy();
    expect(typeof adminAudit[0]?.hash).toBe('string');
    expect(adminAudit[0]?.hash.length).toBeGreaterThan(0);
  });

  it('chains multiple entries correctly', async () => {
    await logAdminAuditEntry(baseInput);
    await logAdminAuditEntry({ ...baseInput, action: 'impersonation:exit' });

    const { adminAudit } = useMockStore.getState();
    expect(adminAudit).toHaveLength(2);
    expect(adminAudit[1]?.prev_hash).toBe(adminAudit[0]?.hash);
  });

  it('does NOT write to the tenant audit log', async () => {
    await logAdminAuditEntry(baseInput);
    const { audit } = useMockStore.getState();
    expect(audit).toHaveLength(0);
  });
});

describe('verifyAdminAuditChain', () => {
  beforeEach(resetStore);

  it('returns ok: true for an intact chain', async () => {
    await logAdminAuditEntry(baseInput);
    await logAdminAuditEntry({ ...baseInput, action: 'impersonation:exit' });
    await logAdminAuditEntry({ ...baseInput, action: 'user:read' });

    const { adminAudit } = useMockStore.getState();
    const result = await verifyAdminAuditChain(adminAudit);
    expect(result.ok).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it('returns ok: true for an empty chain', async () => {
    const result = await verifyAdminAuditChain([]);
    expect(result.ok).toBe(true);
  });

  it('detects tampering with entry content (hash mismatch)', async () => {
    await logAdminAuditEntry(baseInput);
    await logAdminAuditEntry({ ...baseInput, action: 'impersonation:exit' });

    const { adminAudit } = useMockStore.getState();
    // Tamper with the first entry's action
    const tampered = adminAudit.map((e, i) => (i === 0 ? { ...e, action: 'TAMPERED' } : e));
    const result = await verifyAdminAuditChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it('detects broken prev_hash linkage', async () => {
    await logAdminAuditEntry(baseInput);
    await logAdminAuditEntry({ ...baseInput, action: 'impersonation:exit' });

    const { adminAudit } = useMockStore.getState();
    // Tamper with prev_hash of second entry (but keep its hash — so hash check
    // will also fail, but brokenAt should be 1 regardless)
    const tampered = adminAudit.map((e, i) => (i === 1 ? { ...e, prev_hash: 'deadbeef' } : e));
    const result = await verifyAdminAuditChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
  });
});
