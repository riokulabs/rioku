/**
 * Tests for the cluster API layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  useClusterNodes,
  useClusterNode,
  useActiveEnrollmentTokens,
  useEnrollmentTokens,
  removeNode,
  generateEnrollmentToken,
  revokeEnrollmentToken,
} from '../api';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('useClusterNodes', () => {
  it('returns seeded cluster nodes', () => {
    const { result } = renderHook(() => useClusterNodes());
    expect(result.current.length).toBeGreaterThanOrEqual(4);
  });

  it('includes a primary node', () => {
    const { result } = renderHook(() => useClusterNodes());
    expect(result.current.some((n) => n.role === 'primary')).toBe(true);
  });

  it('includes a degraded node', () => {
    const { result } = renderHook(() => useClusterNodes());
    expect(result.current.some((n) => n.status === 'degraded')).toBe(true);
  });
});

describe('useClusterNode', () => {
  it('returns a node by ID', () => {
    const existing = Object.values(useMockStore.getState().clusterNodes)[0];
    if (!existing) throw new Error('no seeded cluster nodes');
    const { result } = renderHook(() => useClusterNode(existing.id));
    expect(result.current?.id).toBe(existing.id);
  });

  it('returns undefined for a missing ID', () => {
    const { result } = renderHook(() => useClusterNode('does-not-exist'));
    expect(result.current).toBeUndefined();
  });
});

describe('useEnrollmentTokens', () => {
  it('returns all seeded tokens (active + expired + consumed)', () => {
    const { result } = renderHook(() => useEnrollmentTokens());
    expect(result.current.length).toBeGreaterThanOrEqual(3);
  });
});

describe('useActiveEnrollmentTokens', () => {
  it('returns only non-consumed, non-expired tokens', () => {
    const { result } = renderHook(() => useActiveEnrollmentTokens());
    const nowMs = Date.now();
    for (const tok of result.current) {
      expect(tok.consumed_by_node_id).toBeUndefined();
      expect(new Date(tok.expires_at).getTime()).toBeGreaterThan(nowMs);
    }
  });

  it('has at least 1 active token from seed data', () => {
    const { result } = renderHook(() => useActiveEnrollmentTokens());
    expect(result.current.length).toBeGreaterThanOrEqual(1);
  });
});

describe('removeNode', () => {
  it('removes the node from the store and appends a destructive audit entry', async () => {
    const state = useMockStore.getState();
    // Pick a non-primary node so we can remove it
    const target = Object.values(state.clusterNodes).find((n) => n.role !== 'primary');
    if (!target) throw new Error('no removable node in seed data');

    const auditBefore = state.audit.length;
    await removeNode(target.id);

    expect(useMockStore.getState().clusterNodes[target.id]).toBeUndefined();
    const audit = useMockStore.getState().audit;
    expect(audit.length).toBe(auditBefore + 1);
    expect(audit.at(-1)?.action).toBe('cluster.node.remove');
    expect(audit.at(-1)?.tier).toBe('destructive');
  });

  it('throws when the node does not exist', async () => {
    await expect(removeNode('nonexistent-node-id')).rejects.toThrow();
  });
});

describe('generateEnrollmentToken', () => {
  it('creates a token in the store and appends an audit entry', async () => {
    const tokensBefore = Object.keys(useMockStore.getState().clusterEnrollmentTokens).length;
    const auditBefore = useMockStore.getState().audit.length;

    const token = await generateEnrollmentToken();

    expect(token.token).toMatch(/^rkjoin_/);
    expect(token.expires_at).toBeDefined();
    expect(useMockStore.getState().clusterEnrollmentTokens[token.id]).toBeDefined();
    expect(Object.keys(useMockStore.getState().clusterEnrollmentTokens).length).toBe(tokensBefore + 1);

    const audit = useMockStore.getState().audit;
    expect(audit.length).toBe(auditBefore + 1);
    expect(audit.at(-1)?.action).toBe('cluster.enrollment_token.generate');
  });
});

describe('revokeEnrollmentToken', () => {
  it('removes an active token and appends a destructive audit entry', async () => {
    // Generate a token then revoke it
    const token = await generateEnrollmentToken();
    const auditBefore = useMockStore.getState().audit.length;

    await revokeEnrollmentToken(token.id);

    expect(useMockStore.getState().clusterEnrollmentTokens[token.id]).toBeUndefined();
    const audit = useMockStore.getState().audit;
    expect(audit.length).toBe(auditBefore + 1);
    expect(audit.at(-1)?.action).toBe('cluster.enrollment_token.revoke');
    expect(audit.at(-1)?.tier).toBe('destructive');
  });

  it('throws when the token does not exist', async () => {
    await expect(revokeEnrollmentToken('nonexistent-token')).rejects.toThrow();
  });
});
