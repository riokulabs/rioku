/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the audit API layer — list selectors, async-search,
 * export (CSV + JSONL), retention CRUD, and permission-aware redaction.
 *
 * Stage 2: `subscribeAuditStream` removed (SSE wired via `subscribeSSE`
 * in streaming-tail.tsx, tested in streaming-tail.test.tsx).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  decodeActorHandle,
  decodeResourceHandle,
  encodeActorHandle,
  encodeResourceHandle,
  exportAuditCsv,
  exportAuditJsonl,
  searchActors,
  searchResourceIds,
  updateRetentionConfig,
  useAuditDetail,
  useAuditList,
  useAuditListInfinite,
  useRetentionConfig,
} from '../api';
import type { AuditEntry, AuditFilter } from '../types';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function tenantIdBySlug(slug: string): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === slug);
  if (!tenant) throw new Error(`No tenant with slug ${slug}`);
  return tenant.id;
}

function emptyFilter(): AuditFilter {
  return {
    actions: [],
    outcomes: [],
    resource_types: [],
    tiers: [],
    date_from: null,
    date_to: null,
    actor_handles: [],
    resource_id_handles: [],
    search: '',
  };
}

/** Sign in as an admin (or super-admin) in the target tenant so permission-gated paths pass. */
function signInAdmin(tenantId: string): string {
  const s = useMockStore.getState();
  const membership = Object.values(s.memberships).find(
    (m) =>
      m.tenant_id === tenantId &&
      m.state === 'active' &&
      m.role_ids.some((rid) => {
        const name = s.roles[rid]?.name;
        return name === 'admin' || name === 'super-admin';
      }),
  );
  if (!membership) throw new Error('No admin membership seeded for tenant');
  useMockStore.setState({
    currentUserId: membership.user_id,
    currentTenantId: tenantId,
  });
  return membership.user_id;
}

/** Sign in as a viewer so sensitive paths are blocked. */
function signInViewer(tenantId: string): string {
  const s = useMockStore.getState();
  const membership = Object.values(s.memberships).find(
    (m) =>
      m.tenant_id === tenantId &&
      m.state === 'active' &&
      m.role_ids.some((rid) => s.roles[rid]?.name === 'viewer'),
  );
  if (!membership) throw new Error('No viewer membership seeded for tenant');
  useMockStore.setState({
    currentUserId: membership.user_id,
    currentTenantId: tenantId,
  });
  return membership.user_id;
}

describe('handle codec', () => {
  it('round-trips actor handles', () => {
    expect(decodeActorHandle(encodeActorHandle('user-42'))).toBe('user-42');
  });

  it('round-trips resource handles', () => {
    const h = encodeResourceHandle('service', 'svc-123');
    expect(decodeResourceHandle(h)).toEqual({
      resource_type: 'service',
      resource_id: 'svc-123',
    });
  });

  it('returns null for malformed handles', () => {
    expect(decodeActorHandle('malformed')).toBeNull();
    expect(decodeResourceHandle('malformed')).toBeNull();
    expect(decodeResourceHandle('res_only-one')).toBeNull();
  });
});

describe('useAuditList', () => {
  it('filters by tenant and sorts desc by `at`', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() => useAuditList(tenantId, emptyFilter()));
    expect(result.current.length).toBeGreaterThan(0);
    for (const e of result.current) {
      expect(e.tenant_id).toBe(tenantId);
    }
    for (let i = 1; i < result.current.length; i++) {
      expect(result.current[i - 1]!.at >= result.current[i]!.at).toBe(true);
    }
  });

  it('filters by action (bounded)', () => {
    const tenantId = tenantIdBySlug('acme');
    const action = useMockStore.getState().audit.find((e) => e.tenant_id === tenantId)!.action;
    const { result } = renderHook(() =>
      useAuditList(tenantId, { ...emptyFilter(), actions: [action] }),
    );
    for (const e of result.current) expect(e.action).toBe(action);
  });

  it('filters by outcome', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() =>
      useAuditList(tenantId, { ...emptyFilter(), outcomes: ['denied'] }),
    );
    for (const e of result.current) expect(e.outcome).toBe('denied');
  });

  it('filters by tier', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() =>
      useAuditList(tenantId, { ...emptyFilter(), tiers: ['destructive'] }),
    );
    for (const e of result.current) expect(e.tier).toBe('destructive');
  });

  it('filters by date range', () => {
    const tenantId = tenantIdBySlug('acme');
    const all = useMockStore.getState().audit.filter((e) => e.tenant_id === tenantId);
    expect(all.length).toBeGreaterThan(0);
    const mid = all[Math.floor(all.length / 2)]!;
    const { result } = renderHook(() =>
      useAuditList(tenantId, { ...emptyFilter(), date_from: mid.at }),
    );
    for (const e of result.current) expect(e.at >= mid.at).toBe(true);
  });

  it('filters by actor_handles (opaque user handles)', () => {
    const tenantId = tenantIdBySlug('acme');
    const entry = useMockStore.getState().audit.find((e) => e.tenant_id === tenantId)!;
    const { result } = renderHook(() =>
      useAuditList(tenantId, {
        ...emptyFilter(),
        actor_handles: [encodeActorHandle(entry.actor_id)],
      }),
    );
    for (const e of result.current) expect(e.actor_id).toBe(entry.actor_id);
  });

  it('filters by resource_id_handles (opaque resource handles)', () => {
    const tenantId = tenantIdBySlug('acme');
    const entry = useMockStore
      .getState()
      .audit.find((e) => e.tenant_id === tenantId && e.resource_id !== undefined)!;
    const { result } = renderHook(() =>
      useAuditList(tenantId, {
        ...emptyFilter(),
        resource_id_handles: [encodeResourceHandle(entry.resource_type, entry.resource_id!)],
      }),
    );
    for (const e of result.current) {
      expect(e.resource_type).toBe(entry.resource_type);
      expect(e.resource_id).toBe(entry.resource_id);
    }
  });

  it('search matches action + resource_type when sensitive perm absent', () => {
    const tenantId = tenantIdBySlug('acme');
    signInViewer(tenantId);
    const { result } = renderHook(() =>
      useAuditList(tenantId, { ...emptyFilter(), search: 'user.login' }),
    );
    for (const e of result.current) {
      expect(e.action.includes('user.login')).toBe(true);
    }
  });
});

describe('useAuditDetail', () => {
  it('returns the entry with the given id', () => {
    const tenantId = tenantIdBySlug('acme');
    const entry = useMockStore.getState().audit.find((e) => e.tenant_id === tenantId)!;
    const { result } = renderHook(() => useAuditDetail(entry.id));
    expect(result.current?.id).toBe(entry.id);
  });

  it('returns undefined for unknown ids', () => {
    const { result } = renderHook(() => useAuditDetail('missing'));
    expect(result.current).toBeUndefined();
  });
});

describe('useAuditListInfinite', () => {
  it('paginates and exposes fetchNextPage', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() => useAuditListInfinite(tenantId, emptyFilter(), 10));
    expect(result.current.data.length).toBeLessThanOrEqual(10);
    expect(result.current.hasNextPage).toBe(true);
    act(() => {
      result.current.fetchNextPage();
    });
    expect(result.current.data.length).toBeLessThanOrEqual(20);
  });
});

// NOTE: `subscribeAuditStream` (mock EventTarget bus) was removed in Stage 2.
// The SSE live-tail is tested via streaming-tail.test.tsx which mocks EventSource.

describe('exportAuditCsv', () => {
  it('emits a Blob with the canonical header', async () => {
    const tenantId = tenantIdBySlug('acme');
    signInAdmin(tenantId);
    const blob = exportAuditCsv(tenantId, emptyFilter());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain('text/csv');
    const text = await blob.text();
    expect(text.split('\n')[0]).toBe(
      'at,actor_id,action,resource_type,resource_id,outcome,tier,ip,request_id',
    );
  });

  it('one row per matching entry', async () => {
    const tenantId = tenantIdBySlug('acme');
    signInAdmin(tenantId);
    const matched = useMockStore.getState().audit.filter((e) => e.tenant_id === tenantId);
    const blob = exportAuditCsv(tenantId, emptyFilter());
    const text = await blob.text();
    expect(text.split('\n').length).toBe(matched.length + 1);
  });

  it('redacts ip when session lacks audit:read-sensitive', async () => {
    const tenantId = tenantIdBySlug('acme');
    signInViewer(tenantId);
    const blob = exportAuditCsv(tenantId, emptyFilter());
    const text = await blob.text();
    // Any row that would carry an IP should now show [redacted] instead.
    // (viewer lacks audit:read-sensitive by default per seed.)
    const hasIpSensitive = useMockStore
      .getState()
      .audit.some((e) => e.tenant_id === tenantId && e.ip !== undefined);
    expect(hasIpSensitive).toBe(true);
    expect(text).not.toMatch(/\b10\.0\./);
    expect(text).toContain('[redacted]');
  });

  it('reveals ip when session has audit:read-sensitive', async () => {
    const tenantId = tenantIdBySlug('acme');
    signInAdmin(tenantId);
    const blob = exportAuditCsv(tenantId, emptyFilter());
    const text = await blob.text();
    expect(text).toMatch(/\b10\.0\./);
    expect(text).not.toContain('[redacted]');
  });
});

describe('exportAuditJsonl', () => {
  it('emits one JSON object per line', async () => {
    const tenantId = tenantIdBySlug('acme');
    signInAdmin(tenantId);
    const blob = exportAuditJsonl(tenantId, emptyFilter());
    expect(blob.type).toContain('application/x-ndjson');
    const text = await blob.text();
    const lines = text.split('\n').filter((l) => l.length > 0);
    for (const line of lines) {
      const obj = JSON.parse(line) as AuditEntry;
      expect(obj.tenant_id).toBe(tenantId);
    }
  });

  it('redacts ip / user_agent / payload when sensitive perm absent', async () => {
    const tenantId = tenantIdBySlug('acme');
    // Inject an entry with payload + user_agent so the redaction path has
    // something to find even though the seed omits payloads by default.
    useMockStore.getState().appendAudit({
      id: 'audit-redact-test',
      tenant_id: tenantId,
      actor_id: 'u',
      action: 'user.login',
      resource_type: 'user',
      outcome: 'success',
      at: new Date().toISOString(),
      tier: 'read',
      ip: '10.0.9.9',
      user_agent: 'curl/8.0',
      payload: { secret: 'topsecret' },
    });
    signInViewer(tenantId);
    const blob = exportAuditJsonl(tenantId, emptyFilter());
    const text = await blob.text();
    expect(text).not.toContain('topsecret');
    expect(text).toContain('"ip":"[redacted]"');
    expect(text).toContain('"user_agent":"[redacted]"');
  });
});

describe('searchActors', () => {
  it('returns tenant members as opaque handles', async () => {
    const tenantId = tenantIdBySlug('acme');
    const page = await searchActors(tenantId, '');
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(item.handle.startsWith('user_')).toBe(true);
    }
  });

  it('filters by query (case-insensitive)', async () => {
    const tenantId = tenantIdBySlug('acme');
    const anyUser = Object.values(useMockStore.getState().users)[0]!;
    const needle = anyUser.email.split('@')[0]!.toLowerCase();
    const page = await searchActors(tenantId, needle);
    for (const item of page.items) {
      expect(item.label.toLowerCase().includes(needle)).toBe(true);
    }
  });

  it('paginates via opaque cursor', async () => {
    const tenantId = tenantIdBySlug('acme');
    // seed has multiple viewers in acme; set page size via repeated paging.
    const first = await searchActors(tenantId, '');
    if (first.nextCursor) {
      const second = await searchActors(tenantId, '', first.nextCursor);
      expect(second.items.length).toBeGreaterThan(0);
    }
  });
});

describe('searchResourceIds', () => {
  it('returns unique resource ids for the given type', async () => {
    const tenantId = tenantIdBySlug('acme');
    const entry = useMockStore
      .getState()
      .audit.find((e) => e.tenant_id === tenantId && e.resource_id !== undefined)!;
    const page = await searchResourceIds(tenantId, entry.resource_type, '');
    const handles = page.items.map((i) => i.handle);
    const unique = new Set(handles);
    expect(unique.size).toBe(handles.length);
    for (const item of page.items) {
      expect(item.resource_type).toBe(entry.resource_type);
    }
  });
});

describe('useRetentionConfig + updateRetentionConfig', () => {
  it('returns the seeded retention config per tenant', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() => useRetentionConfig(tenantId));
    expect(result.current).toBeDefined();
    expect(result.current!.tenant_id).toBe(tenantId);
  });

  it('persists an update and emits an audit entry', async () => {
    const tenantId = tenantIdBySlug('acme');
    signInAdmin(tenantId);
    const auditBefore = useMockStore.getState().audit.length;
    const next = await updateRetentionConfig(tenantId, {
      retention_days: {
        read: 7,
        'read-sensitive': 30,
        write: 60,
        destructive: 120,
      },
      auto_export: 'daily',
      auto_export_format: 'csv',
    });
    expect(next.retention_days.read).toBe(7);
    expect(next.auto_export).toBe('daily');
    expect(useMockStore.getState().audit.length).toBe(auditBefore + 1);
    const last = useMockStore.getState().audit[useMockStore.getState().audit.length - 1]!;
    expect(last.action).toBe('audit.retention.update');
    expect(last.resource_type).toBe('audit-retention');
  });
});
