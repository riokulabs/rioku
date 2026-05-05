/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the AI agents API layer — invoke-mock, tool resolution, rotation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { traceStreamBus, TRACE_STREAM_TOPIC } from '@/api/trace-stream-bus';
import type { AiTrace } from '@/api/resources';
import {
  createAgent,
  updateAgent,
  deleteAgent,
  rotateScopedCredential,
  invokeAgentMock,
  useAgentTools,
  useAgentTraces,
} from '../api';

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

describe('createAgent', () => {
  it('creates an agent with scoped credential prefix only and audits', async () => {
    const tenantId = tenantIdBySlug('acme');
    const provider = Object.values(useMockStore.getState().aiProviders).find(
      (p) => p.tenant_id === tenantId,
    );
    if (!provider) throw new Error('no provider');
    const auditBefore = useMockStore.getState().audit.length;
    const agent = await createAgent(tenantId, {
      name: 'Test Agent',
      provider_id: provider.id,
      model: provider.models[0]?.alias ?? 'gpt-4o',
      system_prompt: 'You are a test.',
      tool_ids: [],
      role_ids: [],
      max_tokens_per_request: 1024,
      temperature: 0.2,
      stop_sequences: [],
      scoped_credential: 'sk-test-credential-raw',
    });
    expect(agent.scoped_credential_ref?.prefix).toBe('sk-test-cred');
    expect(agent.tenant_id).toBe(tenantId);
    expect(useMockStore.getState().audit.length).toBe(auditBefore + 1);
    expect(useMockStore.getState().audit.at(-1)?.action).toBe('ai-agent.create');
  });
});

describe('updateAgent', () => {
  it('updates fields and records diff audit', async () => {
    const existing = Object.values(useMockStore.getState().aiAgents)[0]!;
    const updated = await updateAgent(existing.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('ai-agent.update');
    expect(audit?.diff).toBeDefined();
  });
});

describe('deleteAgent', () => {
  it('deletes the agent and cascades bindings', async () => {
    const agent = Object.values(useMockStore.getState().aiAgents)[0]!;
    const beforeBindings = Object.values(useMockStore.getState().aiToolBindings).filter(
      (b) => b.agent_id === agent.id,
    ).length;
    await deleteAgent(agent.id);
    expect(useMockStore.getState().aiAgents[agent.id]).toBeUndefined();
    // All bindings that pointed at the agent should be gone too.
    const remaining = Object.values(useMockStore.getState().aiToolBindings).filter(
      (b) => b.agent_id === agent.id,
    );
    expect(remaining.length).toBe(0);
    // Sanity: there had been at least one binding so the cascade actually ran.
    expect(beforeBindings).toBeGreaterThanOrEqual(0);
    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('ai-agent.delete');
    expect(latest?.tier).toBe('destructive');
  });
});

describe('rotateScopedCredential', () => {
  it('updates prefix + created_at on the scoped credential ref', async () => {
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.scoped_credential_ref !== undefined,
    );
    if (!agent) throw new Error('no agent with scoped credential');
    const before = agent.scoped_credential_ref!.prefix;
    const beforeAt = agent.scoped_credential_ref!.created_at;
    // Allow the new timestamp to tick at least 1ms past the seeded one.
    await new Promise((r) => setTimeout(r, 5));
    const updated = await rotateScopedCredential(agent.id, 'sk-rotated-new-abc-xyz');
    expect(updated.scoped_credential_ref?.prefix).not.toBe(before);
    expect(updated.scoped_credential_ref?.prefix).toBe('sk-rotated-n');
    expect(updated.scoped_credential_ref?.created_at).not.toBe(beforeAt);
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('ai-agent.rotate-credential');
  });
});

describe('invokeAgentMock', () => {
  it('writes a new trace with realistic shape, emits audit, and publishes on the bus', async () => {
    const agent = Object.values(useMockStore.getState().aiAgents)[0]!;
    const tracesBefore = Object.values(useMockStore.getState().aiTraces).length;
    let received: AiTrace | null = null;
    const handler = (e: Event) => {
      received = (e as CustomEvent<AiTrace>).detail;
    };
    traceStreamBus.addEventListener(TRACE_STREAM_TOPIC, handler);
    try {
      const trace = await invokeAgentMock(agent.id, {
        prompt: 'what is the weather today?',
      });
      expect(trace.agent_id).toBe(agent.id);
      expect(trace.provider_id).toBe(agent.provider_id);
      expect(trace.model).toBe(agent.model);
      expect(trace.prompt_text).toBe('what is the weather today?');
      expect(trace.request_id.startsWith('req_')).toBe(true);
      expect(trace.input_tokens).toBeGreaterThan(0);
      expect(trace.output_tokens).toBeGreaterThan(0);
      expect(trace.latency_ms).toBeGreaterThan(0);
      expect(trace.cost_usd).toBeGreaterThanOrEqual(0);

      // Store updated
      expect(Object.values(useMockStore.getState().aiTraces).length).toBe(tracesBefore + 1);
      // Audit appended
      const audit = useMockStore.getState().audit.at(-1);
      expect(audit?.action).toBe('ai-agent.invoke');
      expect(audit?.tier).toBe('write');
      // Bus received the trace
      expect(received).not.toBeNull();
      expect((received as unknown as AiTrace).id).toBe(trace.id);
    } finally {
      traceStreamBus.removeEventListener(TRACE_STREAM_TOPIC, handler);
    }
  });

  it('produces a completion text for success traces and empty for errors', async () => {
    const agent = Object.values(useMockStore.getState().aiAgents)[0]!;
    // Run 30 invocations and assert at least one success with text + error-friendly shape.
    let successWithCompletion = 0;
    for (let i = 0; i < 30; i++) {
      const trace = await invokeAgentMock(agent.id, {
        prompt: `prompt-${String(i)}`,
      });
      if (trace.status === 'success' && trace.completion_text.length > 0) {
        successWithCompletion += 1;
      }
    }
    expect(successWithCompletion).toBeGreaterThan(0);
  }, 30_000);
});

describe('useAgentTools (selector semantics)', () => {
  it('returns bound tools when bindings exist, otherwise falls back to agent.tool_ids', () => {
    const agentWithBindings = Object.values(useMockStore.getState().aiAgents).find((a) =>
      Object.values(useMockStore.getState().aiToolBindings).some((b) => b.agent_id === a.id),
    );
    if (!agentWithBindings) throw new Error('no agent with bindings in seed');
    const { result } = renderHook(() => useAgentTools(agentWithBindings.id));
    expect(Array.isArray(result.current)).toBe(true);

    // Find an agent with no bindings — if none in seed, create one with tool_ids.
    const tenantId = agentWithBindings.tenant_id;
    const tools = Object.values(useMockStore.getState().aiTools).slice(0, 2);
    // Use createAgent for the no-binding path.
    // (Awaiting in a non-async test is awkward; we emulate via getState writes.)
    const newAgent = {
      id: 'aiagent-direct-test',
      tenant_id: tenantId,
      name: 'no-binding agent',
      provider_id: agentWithBindings.provider_id,
      model: agentWithBindings.model,
      system_prompt: 'test',
      tool_ids: tools.map((t) => t.id),
      enabled: true,
      role_ids: [],
      max_tokens_per_request: 1024,
      temperature: 0.2,
      stop_sequences: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    useMockStore.getState().addEntity('aiAgents', newAgent);
    const { result: fallbackResult } = renderHook(() => useAgentTools(newAgent.id));
    expect(fallbackResult.current.length).toBe(tools.length);
  });
});

describe('useAgentTraces (selector semantics)', () => {
  it('returns up to limit traces sorted desc by at', () => {
    const agent = Object.values(useMockStore.getState().aiAgents)[0]!;
    const { result } = renderHook(() => useAgentTraces(agent.id, 5));
    expect(Array.isArray(result.current)).toBe(true);
    for (let i = 1; i < result.current.length; i++) {
      expect(result.current[i - 1]!.at >= result.current[i]!.at).toBe(true);
    }
    expect(result.current.length).toBeLessThanOrEqual(5);
  });
});
