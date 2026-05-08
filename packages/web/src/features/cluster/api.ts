/**
 * Cluster API — Stage 2: backed by the daemon REST endpoints.
 *
 *   GET  /api/v1/cluster/nodes              list nodes
 *   POST /api/v1/cluster/nodes/{id}/remove  remove a node
 *
 * The tenant-scoped per-node + enrollment-token endpoints surfaced in the
 * stage-2 endpoint manifest are not yet wired in `cluster_routes.go`. Until
 * they land, enrollment-token selectors return empty arrays and the mutators
 * throw a deterministic `EnrollmentNotImplementedError`. UI surfaces the
 * empty state cleanly today and will pick up the real endpoints when they
 * appear without further changes here.
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import type { ClusterNode, ClusterEnrollmentToken } from '@/api/resources';

// ─── Daemon shapes ────────────────────────────────────────────────────────────

interface DaemonNodeInfo {
  id: string;
  name: string;
  role: string;
  health: string;
  daemonVersion?: string;
  goVersion?: string;
  storeMode?: string;
  raftAddr?: string;
  isSelf?: boolean;
  isLeader?: boolean;
  lastSeen?: string;
  metrics?: Record<string, string>;
}

interface ListNodesResponse {
  items?: DaemonNodeInfo[];
  total?: number;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

function mapRole(role: string): ClusterNode['role'] {
  switch (role) {
    case 'primary':
    case 'replica':
    case 'witness':
      return role;
    default:
      return 'replica';
  }
}

function mapStatus(health: string): ClusterNode['status'] {
  switch (health) {
    case 'healthy':
    case 'degraded':
    case 'unreachable':
    case 'joining':
    case 'leaving':
      return health;
    default:
      return 'healthy';
  }
}

function num(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function adaptNode(info: DaemonNodeInfo): ClusterNode {
  const lastSeen = info.lastSeen ?? new Date().toISOString();
  return {
    id: info.id,
    name: info.name,
    role: mapRole(info.role),
    status: mapStatus(info.health),
    address: info.raftAddr ?? '',
    version: info.daemonVersion ?? '',
    joined_at: lastSeen,
    last_heartbeat_at: lastSeen,
    metrics: {
      cpu_percent: num(info.metrics?.cpu_percent),
      memory_percent: num(info.metrics?.memory_percent),
      requests_per_second: num(info.metrics?.requests_per_second),
      latency_p95_ms: num(info.metrics?.latency_p95_ms),
    },
  };
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

const CLUSTER_NODES_KEY = ['cluster', 'nodes'] as const;

async function fetchClusterNodes(signal?: AbortSignal): Promise<ClusterNode[]> {
  const init: RequestInit = signal ? { method: 'GET', signal } : { method: 'GET' };
  const wrapped = await customFetch<{ data: ListNodesResponse }>('/cluster/nodes', init);
  const body = wrapped.data;
  return (body.items ?? []).map(adaptNode);
}

async function postRemoveNode(nodeId: string): Promise<void> {
  await customFetch<{ data: unknown }>(`/cluster/nodes/${encodeURIComponent(nodeId)}/remove`, {
    method: 'POST',
  });
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Returns all cluster nodes. */
export function useClusterNodes(): ClusterNode[] {
  const { data } = useQuery({
    queryKey: CLUSTER_NODES_KEY,
    queryFn: ({ signal }) => fetchClusterNodes(signal),
  });
  return data ?? [];
}

/** Returns a single cluster node by ID. Derived from the list query. */
export function useClusterNode(id: string): ClusterNode | undefined {
  const nodes = useClusterNodes();
  return useMemo(() => nodes.find((n) => n.id === id), [nodes, id]);
}

/**
 * Returns all enrollment tokens. The daemon does not yet expose this
 * endpoint; returns an empty array until it lands.
 */
export function useEnrollmentTokens(): ClusterEnrollmentToken[] {
  return [];
}

/** Returns only active enrollment tokens. Empty until daemon support lands. */
export function useActiveEnrollmentTokens(): ClusterEnrollmentToken[] {
  return [];
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export class EnrollmentNotImplementedError extends Error {
  constructor() {
    super('Cluster enrollment-token endpoints are not yet implemented in the daemon');
    this.name = 'EnrollmentNotImplementedError';
  }
}

/** Remove a cluster node by ID. Invalidates the list query on success. */
export async function removeNode(nodeId: string): Promise<void> {
  await postRemoveNode(nodeId);
}

/**
 * React-Query-aware variant. Components that want automatic cache
 * invalidation should use this hook instead of calling `removeNode`
 * directly. Existing direct callers continue to work; they just need
 * to invalidate the list themselves if they want it to refresh.
 */
export function useRemoveNodeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) => postRemoveNode(nodeId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CLUSTER_NODES_KEY });
    },
  });
}

/** Generate a new enrollment token. Not yet implemented. */
export function generateEnrollmentToken(): Promise<ClusterEnrollmentToken> {
  return Promise.reject(new EnrollmentNotImplementedError());
}

/** Revoke an enrollment token by ID. Not yet implemented. */
export function revokeEnrollmentToken(_tokenId: string): Promise<void> {
  return Promise.reject(new EnrollmentNotImplementedError());
}
