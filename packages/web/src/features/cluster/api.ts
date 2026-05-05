/**
 * Cluster API — backed by the Zustand mock store.
 *
 * Selectors pull from the store; mutations simulate latency and emit
 * audit + host events.
 */
import { useMemo } from 'react';
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AuditEntry, ClusterNode, ClusterEnrollmentToken } from '@/api/resources';

const nextNodeAuditId = makeIdFactory('audit-cluster');
const nextTokenId = makeIdFactory('enroll-token-new');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function futureISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAuditEntry(actorId: string, action: string, resourceId?: string): AuditEntry {
  return {
    id: nextNodeAuditId(),
    tenant_id: useMockStore.getState().currentTenantId,
    actor_id: actorId,
    action,
    resource_type: 'cluster',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier: 'write',
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Returns all cluster nodes. */
export function useClusterNodes(): ClusterNode[] {
  const nodes = useMockStore((s) => s.clusterNodes);
  return Object.values(nodes);
}

/** Returns a single cluster node by ID. */
export function useClusterNode(id: string): ClusterNode | undefined {
  return useMockStore((s) => s.clusterNodes[id]);
}

/** Returns all enrollment tokens. */
export function useEnrollmentTokens(): ClusterEnrollmentToken[] {
  const tokens = useMockStore((s) => s.clusterEnrollmentTokens);
  return Object.values(tokens);
}

/** Returns only active (not consumed, not expired) enrollment tokens. */
export function useActiveEnrollmentTokens(): ClusterEnrollmentToken[] {
  const tokens = useMockStore((s) => s.clusterEnrollmentTokens);
  return useMemo(
    () =>
      Object.values(tokens).filter(
        (t) => !t.consumed_by_node_id && new Date(t.expires_at) > new Date(),
      ),
    [tokens],
  );
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Remove a cluster node by ID. */
export async function removeNode(nodeId: string): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const node = state.clusterNodes[nodeId];
  if (!node) throw new Error(`Cluster node ${nodeId} not found`);

  state.deleteEntity('clusterNodes', nodeId);
  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), 'cluster.node.remove', nodeId),
    tier: 'destructive',
  });
  emitHostEvent('cluster.node.removed', { node_id: nodeId, node_name: node.name });
}

/** Generate a new enrollment token. Token expires in 7 days. */
export async function generateEnrollmentToken(): Promise<ClusterEnrollmentToken> {
  await simulateLatency('mutation');

  const id = nextTokenId();
  const actorId = getCurrentActorId();

  // Fake a random-looking token string (deterministic for tests — just id-based).
  const fakeRandom = Math.random().toString(36).slice(2, 18).padEnd(16, '0');
  const token: ClusterEnrollmentToken = {
    id,
    token: `rkjoin_${fakeRandom}${id.replace(/[^a-z0-9]/g, '')}`,
    created_by: actorId,
    expires_at: futureISO(7),
    created_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('clusterEnrollmentTokens', token);
  state.appendAudit(makeAuditEntry(actorId, 'cluster.enrollment_token.generate', id));
  emitHostEvent('cluster.enrollment_token.generated', { token_id: id });
  return token;
}

/** Revoke (delete) an enrollment token by ID. */
export async function revokeEnrollmentToken(tokenId: string): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const token = state.clusterEnrollmentTokens[tokenId];
  if (!token) throw new Error(`Enrollment token ${tokenId} not found`);

  state.deleteEntity('clusterEnrollmentTokens', tokenId);
  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), 'cluster.enrollment_token.revoke', tokenId),
    tier: 'destructive',
  });
  emitHostEvent('cluster.enrollment_token.revoked', { token_id: tokenId });
}
