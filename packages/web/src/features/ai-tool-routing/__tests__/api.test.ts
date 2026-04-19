/**
 * Tests for the AI tool routing (bindings) API layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  createBinding,
  updateBinding,
  deleteBinding,
  bulkAttachToolsToAgent,
  previewCondition,
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

function pickAgentWithoutAllTools(): { agentId: string; freeToolIds: string[] } {
  const state = useMockStore.getState();
  for (const agent of Object.values(state.aiAgents)) {
    const bound = new Set(
      Object.values(state.aiToolBindings)
        .filter((b) => b.agent_id === agent.id)
        .map((b) => b.tool_id),
    );
    const freeToolIds = Object.values(state.aiTools)
      .filter((t) => t.tenant_id === agent.tenant_id && !bound.has(t.id))
      .map((t) => t.id);
    if (freeToolIds.length >= 2) {
      return { agentId: agent.id, freeToolIds: freeToolIds.slice(0, 2) };
    }
  }
  throw new Error('no candidate agent with 2+ free tools in seed');
}

describe('createBinding', () => {
  it('creates a binding and audits', async () => {
    const tenantId = tenantIdBySlug('acme');
    const { agentId, freeToolIds } = pickAgentWithoutAllTools();
    const binding = await createBinding(tenantId, {
      agent_id: agentId,
      tool_id: freeToolIds[0]!,
      condition: '',
    });
    expect(binding.agent_id).toBe(agentId);
    expect(binding.tool_id).toBe(freeToolIds[0]!);
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('ai-tool-binding.create');
  });

  it('rejects duplicate (agent, tool) pair', async () => {
    const tenantId = tenantIdBySlug('acme');
    const { agentId, freeToolIds } = pickAgentWithoutAllTools();
    await createBinding(tenantId, {
      agent_id: agentId,
      tool_id: freeToolIds[0]!,
      condition: '',
    });
    await expect(
      createBinding(tenantId, {
        agent_id: agentId,
        tool_id: freeToolIds[0]!,
        condition: '',
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('updateBinding', () => {
  it('updates condition and records diff', async () => {
    const existing = Object.values(useMockStore.getState().aiToolBindings)[0]!;
    const after = await updateBinding(existing.id, {
      condition: 'request.tenant == "acme"',
    });
    expect(after.condition).toBe('request.tenant == "acme"');
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('ai-tool-binding.update');
    expect(audit?.diff).toBeDefined();
  });
});

describe('deleteBinding', () => {
  it('deletes the binding and records destructive audit', async () => {
    const existing = Object.values(useMockStore.getState().aiToolBindings)[0]!;
    await deleteBinding(existing.id);
    expect(useMockStore.getState().aiToolBindings[existing.id]).toBeUndefined();
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('ai-tool-binding.delete');
    expect(audit?.tier).toBe('destructive');
  });
});

describe('bulkAttachToolsToAgent', () => {
  it('creates bindings for new tools and skips existing ones', async () => {
    const tenantId = tenantIdBySlug('acme');
    const { agentId, freeToolIds } = pickAgentWithoutAllTools();
    // Pre-bind one of them
    await createBinding(tenantId, {
      agent_id: agentId,
      tool_id: freeToolIds[0]!,
      condition: '',
    });
    const bindings = await bulkAttachToolsToAgent(tenantId, agentId, [
      freeToolIds[0]!,
      freeToolIds[1]!,
    ]);
    expect(bindings.length).toBe(2);
    // No duplicate binding created for freeToolIds[0]
    const total = Object.values(useMockStore.getState().aiToolBindings).filter(
      (b) => b.agent_id === agentId && b.tool_id === freeToolIds[0]!,
    );
    expect(total.length).toBe(1);
  });

  it('is idempotent — second call with the same ids is a no-op', async () => {
    const tenantId = tenantIdBySlug('acme');
    const { agentId, freeToolIds } = pickAgentWithoutAllTools();
    await bulkAttachToolsToAgent(tenantId, agentId, freeToolIds);
    const before = Object.values(useMockStore.getState().aiToolBindings).length;
    await bulkAttachToolsToAgent(tenantId, agentId, freeToolIds);
    const after = Object.values(useMockStore.getState().aiToolBindings).length;
    expect(after).toBe(before);
  });
});

describe('previewCondition', () => {
  it('returns parses=true with a deterministic sample_result for valid CEL', async () => {
    const r1 = await previewCondition('request.user.trusted == true', {});
    expect(r1.parses).toBe(true);
    expect(typeof r1.sample_result).toBe('boolean');
    // Deterministic — repeated calls identical
    const r2 = await previewCondition('request.user.trusted == true', {});
    expect(r2.sample_result).toBe(r1.sample_result);
  });

  it('returns parses=false with an error for invalid CEL', async () => {
    const r = await previewCondition('this is not ( valid CEL', {});
    expect(r.parses).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  it('treats empty condition as always-true', async () => {
    const r = await previewCondition('', {});
    expect(r.parses).toBe(true);
    expect(r.sample_result).toBe(true);
  });
});
