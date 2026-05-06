/**
 * AI MCP Servers — daemon-backed hook smoke tests (T8).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import {
  listMCPServers,
  getMCPServer,
  createMCPServer,
  updateMCPServer,
  deleteMCPServer,
  testMCPServer,
  listMCPServerTools,
} from '../daemon-hooks';

const TENANT = 'acme';
const BASE = `*/api/v1/t/${TENANT}/ai/mcp-servers`;

const sample = {
  id: 'mcp-1',
  tenantId: 'tenant-acme',
  name: 'github-mcp',
  url: 'https://mcp.example.com',
  authKind: 'bearer',
  health: 'healthy',
  enabled: true,
  authorizedAgentIds: [],
  lastCheckedAt: null,
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
};

describe('ai-mcp-servers daemon-hooks (T8)', () => {
  beforeEach(() => {
    server.use(
      http.get(BASE, () => HttpResponse.json({ items: [sample], total: 1 })),
      http.get(`${BASE}/mcp-1`, () => HttpResponse.json(sample)),
      http.post(BASE, () =>
        HttpResponse.json({ ...sample, id: 'mcp-new' }, { status: 201 }),
      ),
      http.put(`${BASE}/mcp-1`, () =>
        HttpResponse.json({ ...sample, name: 'renamed' }),
      ),
      http.delete(`${BASE}/mcp-1`, () => new HttpResponse(null, { status: 204 })),
      http.post(`${BASE}/mcp-1/test`, () =>
        HttpResponse.json({ mcpServerId: 'mcp-1', ok: true }),
      ),
      http.get(`${BASE}/mcp-1/tools`, () =>
        HttpResponse.json({ items: [{ id: 'aitool-1', name: 'web' }], total: 1 }),
      ),
    );
  });

  it('lists MCP servers', async () => {
    const res = (await listMCPServers(TENANT)) as { data: { items: unknown[] } };
    expect(res.data.items).toHaveLength(1);
  });

  it('gets an MCP server', async () => {
    const res = (await getMCPServer(TENANT, 'mcp-1')) as unknown as { data: typeof sample };
    expect(res.data.authKind).toBe('bearer');
  });

  it('creates an MCP server', async () => {
    const res = (await createMCPServer(TENANT, {
      name: 'x',
      url: 'https://e.com',
    })) as unknown as { data: typeof sample };
    expect(res.data.id).toBe('mcp-new');
  });

  it('updates an MCP server', async () => {
    const res = (await updateMCPServer(TENANT, 'mcp-1', { name: 'renamed' })) as unknown as {
      data: typeof sample;
    };
    expect(res.data.name).toBe('renamed');
  });

  it('deletes an MCP server', async () => {
    const res = (await deleteMCPServer(TENANT, 'mcp-1')) as { status: number };
    expect(res.status).toBe(204);
  });

  it('tests connectivity', async () => {
    const res = (await testMCPServer(TENANT, 'mcp-1')) as {
      data: { ok: boolean };
    };
    expect(res.data.ok).toBe(true);
  });

  it('lists tools provided by the server', async () => {
    const res = (await listMCPServerTools(TENANT, 'mcp-1')) as {
      data: { items: unknown[]; total: number };
    };
    expect(res.data.total).toBe(1);
  });
});
