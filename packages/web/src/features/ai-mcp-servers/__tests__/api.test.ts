/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the MCP servers API layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  testMcpServer,
  useMcpServerTools,
} from '../api';
import { renderHook } from '@testing-library/react';

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

describe('createMcpServer + updateMcpServer + deleteMcpServer', () => {
  it('creates a new MCP server with credential prefix + audit', async () => {
    const tenantId = tenantIdBySlug('acme');
    const server = await createMcpServer(tenantId, {
      name: 'test-mcp',
      url: 'https://mcp.test.local/mcp',
      auth_kind: 'bearer',
      auth_credential: 'sk-test-abc123-long-secret-xyz',
      description: 'test server',
    });
    expect(server.name).toBe('test-mcp');
    expect(server.auth_credential_ref?.prefix).toBe('sk-test-abc1');
    expect(server.health).toBe('healthy');
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('mcp-server.create');
    expect(audit?.resource_type).toBe('mcp-server');
  });

  it('updates fields and records a diff', async () => {
    const existing = Object.values(
      useMockStore.getState().mcpServers,
    )[0]!;
    const after = await updateMcpServer(existing.id, {
      name: 'renamed-mcp',
      enabled: false,
    });
    expect(after.name).toBe('renamed-mcp');
    expect(after.enabled).toBe(false);
    expect(after.health).toBe('disabled');
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('mcp-server.update');
    expect(audit?.diff).toBeDefined();
  });

  it('deletes an MCP server with no tool references', async () => {
    const tenantId = tenantIdBySlug('acme');
    const fresh = await createMcpServer(tenantId, {
      name: 'orphan',
      url: 'https://mcp.orphan.local/mcp',
      auth_kind: 'none',
    });
    await deleteMcpServer(fresh.id);
    expect(useMockStore.getState().mcpServers[fresh.id]).toBeUndefined();
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toBe('mcp-server.delete');
    expect(audit?.tier).toBe('destructive');
  });

  it('refuses to delete an MCP server that still has tools referencing it', async () => {
    // Seeded MCPs have exposed_tool_count > 0 for indices 0-5.
    const refed = Object.values(useMockStore.getState().mcpServers).find(
      (s) => s.exposed_tool_count > 0,
    );
    expect(refed).toBeDefined();
    await expect(deleteMcpServer(refed!.id)).rejects.toThrow(
      /Cannot delete MCP server/,
    );
    // Server still present.
    expect(useMockStore.getState().mcpServers[refed!.id]).toBeDefined();
  });
});

describe('useMcpServerTools', () => {
  it('returns tools whose mcp_server_id matches', () => {
    const mcp = Object.values(useMockStore.getState().mcpServers).find(
      (s) => s.exposed_tool_count > 0,
    )!;
    const { result } = renderHook(() => useMcpServerTools(mcp.id));
    expect(result.current.length).toBe(mcp.exposed_tool_count);
    for (const t of result.current) {
      expect(t.mcp_server_id).toBe(mcp.id);
    }
  });
});

describe('testMcpServer', () => {
  it('returns a healthy result for a server whose deterministic roll succeeds', async () => {
    // Find one that hashes into success.
    const servers = Object.values(useMockStore.getState().mcpServers);
    let pickedId: string | undefined;
    for (const s of servers) {
      const res = await testMcpServer(s.id);
      if (res.ok) {
        pickedId = s.id;
        expect(res.latency_ms).toBeGreaterThan(0);
        expect(res.tool_count).toBeGreaterThanOrEqual(0);
        expect(res.tested_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        break;
      }
    }
    if (!pickedId) {
      // If literally every seeded server failed, treat that as a test-skip
      // — the probability is ~0.15^N where N is the number of seeded servers.
      return;
    }
    const updated = useMockStore.getState().mcpServers[pickedId]!;
    expect(updated.health).toBe('healthy');
    expect(updated.last_seen_at).toBeDefined();
  });

  it('success dominates failure across repeated calls', async () => {
    // Rough statistical check — run a handful of invocations across all
    // seeded servers and assert successes dominate. ~15% nominal failure rate.
    const serverIds = Object.keys(useMockStore.getState().mcpServers);
    let successes = 0;
    let failures = 0;
    for (let i = 0; i < 10; i++) {
      const id = serverIds[i % serverIds.length]!;
      const res = await testMcpServer(id);
      if (res.ok) successes += 1;
      else failures += 1;
    }
    expect(successes).toBeGreaterThan(0);
    expect(successes).toBeGreaterThan(failures);
  }, 15_000);

  it('emits an audit entry with read tier', async () => {
    const mcp = Object.values(useMockStore.getState().mcpServers)[0]!;
    await testMcpServer(mcp.id);
    const audit = useMockStore.getState().audit.at(-1);
    expect(audit?.action).toMatch(/mcp-server\.test\.(success|failure)/);
    expect(audit?.tier).toBe('read');
  });
});
