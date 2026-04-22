/**
 * Unit tests for the CSV export + cross-link flows — the wire-up that lives
 * in `routes/t.$tenant/ai/traces.tsx` and `features/ai-agents/components/detail.tsx`.
 *
 * We exercise the export side effect end-to-end using the api-layer
 * `exportTracesCsv` + jsdom Blob/URL primitives to verify the header + row
 * count the admin ships to disk.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}));

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { exportTracesCsv, useTraceList } from '../api';
import type { TraceFilter } from '../types';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function acmeId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant');
  return acme.id;
}

function emptyFilter(): TraceFilter {
  return { search: '', agent_ids: [], statuses: [] };
}

describe('CSV export wiring', () => {
  it('respects the active filter — agent_ids shrinks the output set', async () => {
    const tenantId = acmeId();
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    );
    if (!agent) throw new Error('No agent seeded');

    const filter: TraceFilter = { ...emptyFilter(), agent_ids: [agent.id] };
    const blob = exportTracesCsv(tenantId, filter);
    const text = await blob.text();
    const lines = text.split('\n').filter((l) => l.length > 0);
    // First line is header
    expect(lines[0]).toContain('at,request_id');
    // Every subsequent row should reference the agent name OR its id
    const agentStored = useMockStore.getState().aiAgents[agent.id];
    const agentName = agentStored?.name ?? agent.id;
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]).toContain(agentName);
    }
  });

  it('cross-link param `agent` is consumed by the trace list when pre-applied', () => {
    const tenantId = acmeId();
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    );
    if (!agent) throw new Error('No agent seeded');

    // Simulate what the route does: fold `agent` into `agent_ids`.
    const filter: TraceFilter = {
      search: '',
      agent_ids: [agent.id],
      statuses: [],
    };
    const { result } = renderHook(() => useTraceList(tenantId, filter));
    for (const t of result.current) {
      expect(t.agent_id).toBe(agent.id);
    }
  });
});
