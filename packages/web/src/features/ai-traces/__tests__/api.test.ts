 
/**
 * Tests for the AI traces API layer (read-only + streaming-tail + CSV export).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { invokeAgent } from '@/features/ai-agents/api';
import { exportTracesCsv, subscribeTraceStream, useTraceList } from '../api';
import { renderHook } from '@testing-library/react';
import type { AiTrace, TraceFilter } from '../types';

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

function emptyFilter(): TraceFilter {
  return { search: '', agent_ids: [], statuses: [] };
}

describe('useTraceList', () => {
  it('filters by tenant and returns results sorted desc by `at`', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() => useTraceList(tenantId, emptyFilter()));
    expect(result.current.length).toBeGreaterThan(0);
    for (const t of result.current) {
      expect(t.tenant_id).toBe(tenantId);
    }
    for (let i = 1; i < result.current.length; i++) {
      const prev = result.current[i - 1]!;
      const cur = result.current[i]!;
      expect(prev.at >= cur.at).toBe(true);
    }
  });

  it('filters by agent_ids', () => {
    const tenantId = tenantIdBySlug('acme');
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    )!;
    const { result } = renderHook(() =>
      useTraceList(tenantId, { ...emptyFilter(), agent_ids: [agent.id] }),
    );
    for (const t of result.current) {
      expect(t.agent_id).toBe(agent.id);
    }
  });

  it('filters by status', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() =>
      useTraceList(tenantId, { ...emptyFilter(), statuses: ['error'] }),
    );
    for (const t of result.current) {
      expect(t.status).toBe('error');
    }
  });

  it('filters by prompt/completion text search', () => {
    const tenantId = tenantIdBySlug('acme');
    const someTrace = Object.values(useMockStore.getState().aiTraces).find(
      (t) => t.tenant_id === tenantId && t.prompt_text.length > 0,
    )!;
    const needle = someTrace.prompt_text.split(/\s+/)[0]!.toLowerCase();
    const { result } = renderHook(() =>
      useTraceList(tenantId, { ...emptyFilter(), search: needle }),
    );
    expect(result.current.length).toBeGreaterThan(0);
    for (const t of result.current) {
      const hay = (t.prompt_text + ' ' + t.completion_text).toLowerCase();
      expect(hay.includes(needle)).toBe(true);
    }
  });

  it('filters by since/until date range', () => {
    const tenantId = tenantIdBySlug('acme');
    const all = Object.values(useMockStore.getState().aiTraces)
      .filter((t) => t.tenant_id === tenantId)
      .sort((a, b) => (a.at < b.at ? -1 : 1));
    expect(all.length).toBeGreaterThan(2);
    const mid = all[Math.floor(all.length / 2)]!;
    const { result } = renderHook(() =>
      useTraceList(tenantId, { ...emptyFilter(), since: mid.at }),
    );
    for (const t of result.current) {
      expect(t.at >= mid.at).toBe(true);
    }
  });

  it('includes traces on the end day when `until` is set to end-of-day', () => {
    // Mirrors what <TraceFilterBar> emits for a custom range: the UI pushes
    // the end date to 23:59:59.999 so `trace.at >= until` still excludes the
    // next day but keeps every trace recorded on the selected end day.
    const tenantId = tenantIdBySlug('acme');
    const all = Object.values(useMockStore.getState().aiTraces)
      .filter((t) => t.tenant_id === tenantId)
      .sort((a, b) => (a.at < b.at ? -1 : 1));
    expect(all.length).toBeGreaterThan(0);
    const target = all[all.length - 1]!;
    const targetDay = new Date(target.at);
    // Naive midnight-UTC "until" would exclude the target trace — assert the
    // broken behaviour first so the end-of-day fix is meaningful.
    const naiveUntil = new Date(targetDay);
    naiveUntil.setUTCHours(0, 0, 0, 0);
    const { result: naive } = renderHook(() =>
      useTraceList(tenantId, {
        ...emptyFilter(),
        until: naiveUntil.toISOString(),
      }),
    );
    expect(naive.current.some((t) => t.id === target.id)).toBe(false);

    // End-of-day "until" should INCLUDE the target trace.
    const endOfDay = new Date(targetDay);
    endOfDay.setHours(23, 59, 59, 999);
    const { result: inclusive } = renderHook(() =>
      useTraceList(tenantId, {
        ...emptyFilter(),
        until: endOfDay.toISOString(),
      }),
    );
    expect(inclusive.current.some((t) => t.id === target.id)).toBe(true);
  });
});

// subscribeTraceStream tests previously relied on the mock-store-backed
// `invokeAgentMock` to publish traces synchronously. Stage-2 replaces that
// with the daemon SSE-driven `invokeAgent` API; the SSE channel is exercised
// in `ai-traces.test.tsx` ("subscribeTraceStream (SSE)" describe). The
// legacy mock-store path is intentionally retired here.
describe.skip('subscribeTraceStream (legacy mock-store path — migrated to SSE test)', () => {
  it('migrated — see ai-traces.test.tsx subscribeTraceStream (SSE)', () => {
    expect(true).toBe(true);
  });
});

// Keep imports referenced so the file still type-checks against the new API
// shape even while the legacy describe is skipped.
void invokeAgent;
void ({} as AiTrace);

describe('exportTracesCsv', () => {
  it('returns a Blob with the canonical header row', async () => {
    const tenantId = tenantIdBySlug('acme');
    const blob = exportTracesCsv(tenantId, emptyFilter());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain('text/csv');
    const text = await blob.text();
    const firstLine = text.split('\n')[0]!;
    expect(firstLine).toBe(
      'at,request_id,agent_name,model,status,input_tokens,output_tokens,latency_ms,cost_usd',
    );
  });

  it('includes one row per matching trace', async () => {
    const tenantId = tenantIdBySlug('acme');
    const traces = Object.values(useMockStore.getState().aiTraces).filter(
      (t) => t.tenant_id === tenantId,
    );
    const blob = exportTracesCsv(tenantId, emptyFilter());
    const text = await blob.text();
    const lines = text.split('\n');
    expect(lines.length).toBe(traces.length + 1); // +1 header
  });

  it('escapes commas and quotes in text fields', async () => {
    const tenantId = tenantIdBySlug('acme');
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    )!;
    const renamed = { ...agent, name: 'Agent, "Quoted"' };
    useMockStore.getState().updateEntity('aiAgents', agent.id, {
      name: renamed.name,
    });
    const blob = exportTracesCsv(tenantId, {
      ...emptyFilter(),
      agent_ids: [agent.id],
    });
    const text = await blob.text();
    // Escaped form: "Agent, ""Quoted"""
    expect(text).toContain('"Agent, ""Quoted"""');
  });
});
