/**
 * AI Agents — daemon-backed hook smoke tests.
 *
 * Verifies the Orval-generated client hits the right URL and returns the
 * shape declared by the OpenAPI fragment (camelCase fields).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import {
  listAIAgents,
  createAIAgent,
  updateAIAgent,
  deleteAIAgent,
  getAIAgent,
  rotateAIAgentCredential,
} from '../daemon-hooks';

const TENANT = 'acme';
const BASE = `*/api/v1/t/${TENANT}/ai/agents`;

const sampleAgent = {
  id: 'aiagent-1',
  tenantId: 'tenant-acme',
  providerId: 'aiprov-1',
  name: 'Triage',
  description: '',
  model: 'gpt-4o',
  systemPrompt: 'You are helpful.',
  guardrails: {},
  enabled: true,
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
};

describe('ai-agents daemon-hooks (T3)', () => {
  beforeEach(() => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ items: [sampleAgent], total: 1 })),
      http.get(`${BASE}/aiagent-1`, () => HttpResponse.json(sampleAgent)),
      http.post(BASE, () =>
        HttpResponse.json({ ...sampleAgent, id: 'aiagent-new' }, { status: 201 }),
      ),
      http.put(`${BASE}/aiagent-1`, () => HttpResponse.json({ ...sampleAgent, name: 'Updated' })),
      http.delete(`${BASE}/aiagent-1`, () => new HttpResponse(null, { status: 204 })),
      http.post(`${BASE}/aiagent-1/rotate-credential`, () =>
        HttpResponse.json({ agentId: 'aiagent-1', ok: true }),
      ),
    );
  });

  it('lists agents from the daemon', async () => {
    const res = (await listAIAgents(TENANT)) as {
      data: { items: (typeof sampleAgent)[] };
    };
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]?.name).toBe('Triage');
  });

  it('gets a single agent', async () => {
    const res = (await getAIAgent(TENANT, 'aiagent-1')) as { data: typeof sampleAgent };
    expect(res.data.id).toBe('aiagent-1');
    expect(res.data.providerId).toBe('aiprov-1');
  });

  it('creates an agent', async () => {
    const res = (await createAIAgent(TENANT, {
      name: 'New',
      model: 'gpt-4o',
      systemPrompt: 'helpful',
    })) as { data: typeof sampleAgent };
    expect(res.data.id).toBe('aiagent-new');
  });

  it('updates an agent', async () => {
    const res = (await updateAIAgent(TENANT, 'aiagent-1', { name: 'Updated' })) as {
      data: typeof sampleAgent;
    };
    expect(res.data.name).toBe('Updated');
  });

  it('deletes an agent', async () => {
    const res = (await deleteAIAgent(TENANT, 'aiagent-1')) as { status: number };
    expect(res.status).toBe(204);
  });

  it('rotates a credential', async () => {
    const res = (await rotateAIAgentCredential(TENANT, 'aiagent-1')) as {
      data: { ok: boolean };
    };
    expect(res.data.ok).toBe(true);
  });
});
