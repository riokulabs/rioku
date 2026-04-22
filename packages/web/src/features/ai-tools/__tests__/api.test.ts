/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the AI tools API layer — CRUD, delete-guard, testTool validation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { createTool, updateTool, deleteTool, testTool } from '../api';
import { ToolInUseError } from '../types';

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

describe('createTool', () => {
  it('creates an http tool with endpoint and audits', async () => {
    const tenantId = tenantIdBySlug('acme');
    const tool = await createTool(tenantId, {
      name: 'fetch-weather',
      description: 'Fetch current weather',
      schema: {
        type: 'object',
        required: ['lat', 'lon'],
        properties: {
          lat: { type: 'number' },
          lon: { type: 'number' },
        },
      },
      kind: 'http',
      http_endpoint: { url: 'https://weather.example/v1', method: 'GET' },
      dangerous: false,
      enabled: true,
    });
    expect(tool.kind).toBe('http');
    expect(tool.http_endpoint?.url).toBe('https://weather.example/v1');
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('ai-tool.create');
  });

  it('creates an mcp tool referencing an existing server', async () => {
    const tenantId = tenantIdBySlug('acme');
    const mcpId = Object.keys(useMockStore.getState().mcpServers)[0]!;
    const tool = await createTool(tenantId, {
      name: 'mcp-tool',
      description: 'MCP tool',
      schema: {},
      kind: 'mcp',
      mcp_server_id: mcpId,
    });
    expect(tool.mcp_server_id).toBe(mcpId);
  });
});

describe('updateTool', () => {
  it('updates name + description and records diff audit', async () => {
    const existing = Object.values(useMockStore.getState().aiTools)[0]!;
    const updated = await updateTool(existing.id, {
      name: 'renamed-tool',
      description: 'updated desc',
    });
    expect(updated.name).toBe('renamed-tool');
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('ai-tool.update');
    expect(audit?.diff).toBeDefined();
  });
});

describe('deleteTool', () => {
  it('throws ToolInUseError when an agent references the tool', async () => {
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tool_ids.length > 0,
    );
    if (!agent) throw new Error('no agent has tools');
    const toolId = agent.tool_ids[0]!;
    await expect(deleteTool(toolId)).rejects.toThrow(ToolInUseError);
  });

  it('throws ToolInUseError when only a binding references the tool', async () => {
    // Create a tool, then bind it to an agent but do NOT put it in the agent's tool_ids list.
    const tenantId = tenantIdBySlug('acme');
    const agent = Object.values(useMockStore.getState().aiAgents)[0]!;
    const tool = await createTool(tenantId, {
      name: 'binding-only',
      description: 'only referenced via binding',
      schema: {},
      kind: 'native',
    });
    // Hand-insert a binding (matches aiToolBindings shape).
    useMockStore.getState().addEntity('aiToolBindings', {
      id: 'binding-test-1',
      tenant_id: tenantId,
      agent_id: agent.id,
      tool_id: tool.id,
      condition: '',
      enabled: true,
      created_at: new Date().toISOString(),
    });
    await expect(deleteTool(tool.id)).rejects.toThrow(ToolInUseError);
  });

  it('deletes successfully when no agent or binding references the tool', async () => {
    const tenantId = tenantIdBySlug('acme');
    const tool = await createTool(tenantId, {
      name: 'orphan',
      description: 'unreferenced',
      schema: {},
      kind: 'native',
    });
    await deleteTool(tool.id);
    expect(useMockStore.getState().aiTools[tool.id]).toBeUndefined();
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('ai-tool.delete');
    expect(audit?.tier).toBe('destructive');
  });
});

describe('testTool', () => {
  it('returns ok when sample input satisfies required schema fields', async () => {
    const tenantId = tenantIdBySlug('acme');
    const tool = await createTool(tenantId, {
      name: 'validated',
      description: 'tool with required schema',
      schema: {
        type: 'object',
        required: ['city'],
        properties: { city: { type: 'string' } },
      },
      kind: 'native',
    });
    const result = await testTool(tool.id, { city: 'Austin' });
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it('fails when a required field is missing', async () => {
    const tenantId = tenantIdBySlug('acme');
    const tool = await createTool(tenantId, {
      name: 'strict',
      description: 'required fields',
      schema: {
        type: 'object',
        required: ['user_id'],
        properties: { user_id: { type: 'string' } },
      },
      kind: 'native',
    });
    const result = await testTool(tool.id, { other_field: 'abc' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('user_id');
  });

  it('fails when a field type is wrong', async () => {
    const tenantId = tenantIdBySlug('acme');
    const tool = await createTool(tenantId, {
      name: 'typed',
      description: 'typed schema',
      schema: {
        type: 'object',
        required: [],
        properties: { count: { type: 'integer' } },
      },
      kind: 'native',
    });
    const result = await testTool(tool.id, { count: 'three' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('count');
  });
});
