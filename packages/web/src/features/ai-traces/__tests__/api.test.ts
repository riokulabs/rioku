/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the AI traces API layer (read-only + streaming-tail + CSV export).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { invokeAgentMock } from '@/features/ai-agents/api';
import {
  exportTracesCsv,
  subscribeTraceStream,
  useTraceList,
} from '../api';
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
});

describe('subscribeTraceStream', () => {
  it('fires when invokeAgentMock publishes a trace for the tenant', async () => {
    const tenantId = tenantIdBySlug('acme');
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    )!;
    const received: AiTrace[] = [];
    const unsub = subscribeTraceStream(tenantId, (t) => {
      received.push(t);
    });
    try {
      const trace = await invokeAgentMock(agent.id, { prompt: 'hello world' });
      expect(received.length).toBe(1);
      expect(received[0]!.id).toBe(trace.id);
    } finally {
      unsub();
    }
  });

  it('ignores traces from other tenants', async () => {
    const acmeId = tenantIdBySlug('acme');
    const otherAgent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id !== acmeId,
    );
    if (!otherAgent) {
      // Seed might not include multiple tenants with agents — skip softly.
      return;
    }
    const received: AiTrace[] = [];
    const unsub = subscribeTraceStream(acmeId, (t) => {
      received.push(t);
    });
    try {
      await invokeAgentMock(otherAgent.id, { prompt: 'from another tenant' });
      expect(received.length).toBe(0);
    } finally {
      unsub();
    }
  });

  it('returns an unsubscribe function that stops future notifications', async () => {
    const tenantId = tenantIdBySlug('acme');
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    )!;
    let count = 0;
    const unsub = subscribeTraceStream(tenantId, () => {
      count += 1;
    });
    await invokeAgentMock(agent.id, { prompt: 'first' });
    unsub();
    await invokeAgentMock(agent.id, { prompt: 'second' });
    expect(count).toBe(1);
  });
});

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
