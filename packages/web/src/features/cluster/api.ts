/**
 * Cluster API — Stage 2: backed by the daemon REST endpoints.
 *
 *   GET  /api/v1/cluster/nodes                                  list nodes
 *   POST /api/v1/cluster/nodes/{id}/remove                      remove a node
 *   GET  /api/v1/t/{tenant}/cluster/enrollment-tokens           list active tokens
 *   POST /api/v1/t/{tenant}/cluster/enrollment-tokens           create a token
 *   DELETE /api/v1/t/{tenant}/cluster/enrollment-tokens/{id}    revoke a token
 *
 * Tokens are tenant-scoped at the URL layer even though the underlying
 * resource is global — that's the contract from
 * `webhooks_cluster_impersonation_routes.go`.
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

// ─── Enrollment-token shapes ──────────────────────────────────────────────────

interface DaemonEnrollmentToken {
  id: string;
  tokenHash?: string;
  notes?: string;
  createdBy?: string;
  createdAt?: string;
  expiresAt?: string;
  consumedAt?: string;
  revokedAt?: string;
}

interface DaemonCreateEnrollmentTokenResponse extends DaemonEnrollmentToken {
  // Plaintext token — only returned on create, never again.
  token?: string;
}

function adaptEnrollmentToken(t: DaemonEnrollmentToken, plaintext?: string): ClusterEnrollmentToken {
  const now = new Date().toISOString();
  return {
    id: t.id,
    token: plaintext ?? '',
    created_at: t.createdAt ?? now,
    created_by: t.createdBy ?? '',
    expires_at: t.expiresAt ?? now,
    ...(t.consumedAt ? { consumed_at: t.consumedAt } : {}),
    ...(t.revokedAt ? { revoked_at: t.revokedAt } : {}),
  };
}

const ENROLLMENT_TOKENS_KEY = ['cluster', 'enrollment-tokens'] as const;

function resolveTenantSlugFromPath(): string {
  if (typeof window === 'undefined') return 'default';
  const m = /\/t\/([^/]+)/.exec(window.location.pathname);
  return m?.[1] ?? 'default';
}

async function fetchEnrollmentTokens(signal?: AbortSignal): Promise<ClusterEnrollmentToken[]> {
  const tenant = resolveTenantSlugFromPath();
  const init: RequestInit = signal ? { method: 'GET', signal } : { method: 'GET' };
  const wrapped = await customFetch<{ data: { items?: DaemonEnrollmentToken[] } }>(
    `/t/${encodeURIComponent(tenant)}/cluster/enrollment-tokens`,
    init,
  );
  return (wrapped.data.items ?? []).map((t) => adaptEnrollmentToken(t));
}

/** Returns all enrollment tokens for the active tenant. */
export function useEnrollmentTokens(): ClusterEnrollmentToken[] {
  const { data } = useQuery({
    queryKey: ENROLLMENT_TOKENS_KEY,
    queryFn: ({ signal }) => fetchEnrollmentTokens(signal),
  });
  return data ?? [];
}

/** Returns only active (unconsumed, unrevoked, unexpired) enrollment tokens. */
export function useActiveEnrollmentTokens(): ClusterEnrollmentToken[] {
  const tokens = useEnrollmentTokens();
  const now = Date.now();
  return tokens.filter((t) => {
    if (t.consumed_at) return false;
    if (t.revoked_at) return false;
    if (t.expires_at && new Date(t.expires_at).getTime() < now) return false;
    return true;
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

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

/**
 * Generate a new enrollment token. Returns the token (plaintext) plus
 * its metadata — the daemon only emits the plaintext on create, never
 * again, so the caller must capture it before the modal closes.
 */
export async function generateEnrollmentToken(): Promise<ClusterEnrollmentToken> {
  const tenant = resolveTenantSlugFromPath();
  const wrapped = await customFetch<{ data: DaemonCreateEnrollmentTokenResponse }>(
    `/t/${encodeURIComponent(tenant)}/cluster/enrollment-tokens`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
  );
  return adaptEnrollmentToken(wrapped.data, wrapped.data.token);
}

/** Revoke an enrollment token by ID. */
export async function revokeEnrollmentToken(tokenId: string): Promise<void> {
  const tenant = resolveTenantSlugFromPath();
  await customFetch<{ data: unknown }>(
    `/t/${encodeURIComponent(tenant)}/cluster/enrollment-tokens/${encodeURIComponent(tokenId)}`,
    { method: 'DELETE' },
  );
}
