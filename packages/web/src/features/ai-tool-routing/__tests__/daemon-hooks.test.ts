/**
 * AI Tool-bindings — daemon-backed hook smoke tests (T5).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import {
  listAIToolBindings,
  createAIToolBinding,
  updateAIToolBinding,
  deleteAIToolBinding,
  bulkAttachAIToolBindings,
  previewAIToolBindingCondition,
} from '../daemon-hooks';

const TENANT = 'acme';
const BASE = `*/api/v1/t/${TENANT}/ai/tool-bindings`;

const sample = {
  id: 'bnd-1',
  tenantId: 'tenant-acme',
  agentId: 'aiagent-1',
  toolId: 'aitool-1',
  condition: '',
  enabled: true,
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
};

describe('ai-tool-bindings daemon-hooks (T5)', () => {
  beforeEach(() => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ items: [sample], total: 1 })),
      http.post(BASE, () =>
        HttpResponse.json({ ...sample, id: 'bnd-new' }, { status: 201 }),
      ),
      http.put(`${BASE}/bnd-1`, () => HttpResponse.json({ ...sample, enabled: false })),
      http.delete(`${BASE}/bnd-1`, () => new HttpResponse(null, { status: 204 })),
      http.post(`${BASE}/bulk-attach`, () =>
        HttpResponse.json({ items: [sample], total: 1 }),
      ),
      http.post(`${BASE}/preview-condition`, () =>
        HttpResponse.json({ condition: '', matched: true }),
      ),
    );
  });

  it('lists bindings', async () => {
    const res = (await listAIToolBindings(TENANT)) as { data: { items: unknown[] } };
    expect(res.data.items).toHaveLength(1);
  });

  it('creates a binding', async () => {
    const res = (await createAIToolBinding(TENANT, {
      agentId: 'aiagent-1',
      toolId: 'aitool-1',
    })) as { data: typeof sample };
    expect(res.data.id).toBe('bnd-new');
  });

  it('updates a binding', async () => {
    const res = (await updateAIToolBinding(TENANT, 'bnd-1', { enabled: false })) as {
      data: typeof sample;
    };
    expect(res.data.enabled).toBe(false);
  });

  it('deletes a binding', async () => {
    const res = (await deleteAIToolBinding(TENANT, 'bnd-1')) as { status: number };
    expect(res.status).toBe(204);
  });

  it('bulk-attaches', async () => {
    const res = (await bulkAttachAIToolBindings(TENANT, {
      agentId: 'aiagent-1',
      toolIds: ['aitool-1'],
    })) as { data: { items: unknown[]; total: number } };
    expect(res.data.total).toBe(1);
  });

  it('previews a condition', async () => {
    const res = (await previewAIToolBindingCondition(TENANT, {
      condition: '',
      envelope: {},
    })) as { data: { matched: boolean } };
    expect(res.data.matched).toBe(true);
  });
});
