/**
 * AI Tools — daemon-backed hook smoke tests (T4).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import {
  listAITools,
  getAITool,
  createAITool,
  updateAITool,
  deleteAITool,
  testAITool,
} from '../daemon-hooks';

const TENANT = 'acme';
const BASE = `*/api/v1/t/${TENANT}/ai/tools`;

const sampleTool = {
  id: 'aitool-1',
  tenantId: 'tenant-acme',
  name: 'web-search',
  kind: 'http',
  description: 'search the web',
  schema: {},
  httpEndpoint: 'https://example.com/search',
  mcpServerId: null,
  dangerous: false,
  enabled: true,
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
};

describe('ai-tools daemon-hooks (T4)', () => {
  beforeEach(() => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ items: [sampleTool], total: 1 })),
      http.get(`${BASE}/aitool-1`, () => HttpResponse.json(sampleTool)),
      http.post(BASE, () =>
        HttpResponse.json({ ...sampleTool, id: 'aitool-new' }, { status: 201 }),
      ),
      http.put(`${BASE}/aitool-1`, () => HttpResponse.json({ ...sampleTool, name: 'renamed' })),
      http.delete(`${BASE}/aitool-1`, () => new HttpResponse(null, { status: 204 })),
      http.post(`${BASE}/aitool-1/test`, () => HttpResponse.json({ toolId: 'aitool-1', ok: true })),
    );
  });

  it('lists tools', async () => {
    const res = (await listAITools(TENANT)) as { data: { items: unknown[] } };
    expect(res.data.items).toHaveLength(1);
  });

  it('gets a tool', async () => {
    const res = (await getAITool(TENANT, 'aitool-1')) as { data: typeof sampleTool };
    expect(res.data.kind).toBe('http');
  });

  it('creates a tool', async () => {
    const res = (await createAITool(TENANT, { name: 'x', kind: 'http' })) as {
      data: typeof sampleTool;
    };
    expect(res.data.id).toBe('aitool-new');
  });

  it('updates a tool', async () => {
    const res = (await updateAITool(TENANT, 'aitool-1', { name: 'renamed' })) as {
      data: typeof sampleTool;
    };
    expect(res.data.name).toBe('renamed');
  });

  it('deletes a tool', async () => {
    const res = (await deleteAITool(TENANT, 'aitool-1')) as { status: number };
    expect(res.status).toBe(204);
  });

  it('runs the test stub', async () => {
    const res = (await testAITool(TENANT, 'aitool-1')) as {
      data: { toolId: string; ok: boolean };
    };
    expect(res.data.ok).toBe(true);
  });
});
