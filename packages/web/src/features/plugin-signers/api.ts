/**
 * Plugin signers API — backed by real daemon endpoints (Stage 2).
 *
 * Routes:
 *   Tenant-scoped:  /api/v1/t/{tenant}/plugin-signers
 *   Global (admin): /api/v1/admin/plugin-signers
 *
 * Selectors return TanStack Query result objects. Mutations use useMutation.
 *
 * Stage-1 compatibility: functions that previously worked directly on the
 * Zustand store (createSigner, updateSigner, deleteSigner, verifySigner,
 * revokeSigner) now call the daemon REST API. Components that need
 * legacy hook returns (useSignerList, useSignerDetail, useSignerPlugins)
 * continue to expose the same interface, now backed by useQuery.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import type { PluginSigner, Plugin } from '@/api/resources';
import type { CreateSignerInput, UpdateSignerInput, SignerFilter } from './types';

// ─── Response shapes from daemon ─────────────────────────────────────────────

interface SignerListResponse {
  items: DaemonSigner[];
  total: number;
}

interface PluginListResponse {
  items: DaemonPlugin[];
  total: number;
}

/** Daemon-side signer shape (camelCase JSON from plugins_routes.go). */
interface DaemonSigner {
  id: string;
  tenantScope: string | null;
  name: string;
  fingerprint: string;
  status: 'verified' | 'revoked' | 'pending';
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Daemon-side plugin shape (camelCase JSON from plugins_routes.go). */
interface DaemonPlugin {
  id: string;
  tenantScope: string | null;
  slug: string;
  name: string;
  version: string;
  enabled: boolean;
  buildState: string;
  cosignVerified: boolean;
  signerId: string | null;
  config: unknown;
  metadata: unknown;
  installedAt: string;
  updatedAt: string;
}

// ─── Data mappers (daemon → frontend resource types) ─────────────────────────

function daemonToSigner(d: DaemonSigner): PluginSigner {
  const out: PluginSigner = {
    id: d.id,
    tenant_scope: d.tenantScope ?? null,
    name: d.name,
    fingerprint: d.fingerprint,
    status: d.status,
    created_at: d.createdAt,
  };
  if (d.notes) out.description = d.notes;
  return out;
}

function daemonToPlugin(d: DaemonPlugin): Plugin {
  const out: Plugin = {
    id: d.id,
    tenant_scope: d.tenantScope ?? null,
    slug: d.slug,
    display_name: d.name,
    version: d.version,
    enabled: d.enabled,
    parts: [],
    declared_permissions: [],
    manifest: {},
    has_errors: d.buildState === 'failed',
    build_state: d.buildState as Plugin['build_state'],
    cosign_verified: d.cosignVerified,
  };
  if (d.signerId !== null) out.signer_id = d.signerId;
  return out;
}

// ─── URL builders ─────────────────────────────────────────────────────────────

function signersBaseUrl(tenantId: string | null): string {
  return tenantId !== null ? `/t/${tenantId}/plugin-signers` : `/admin/plugin-signers`;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const signerQueryKeys = {
  list: (tenantId: string | null) => ['plugin-signers', 'list', tenantId] as const,
  detail: (tenantId: string | null, id: string) =>
    ['plugin-signers', 'detail', tenantId, id] as const,
  plugins: (id: string) => ['plugin-signers', 'plugins', id] as const,
} as const;

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Returns signers visible under a scope.
 *   - tenantId === null → global signers (/admin/plugin-signers)
 *   - tenantId is a tenant id → tenant-scoped signers
 *
 * Applies client-side filtering for search and status.
 */
export function useSignerList(tenantId: string | null, filter?: SignerFilter): PluginSigner[] {
  const { data } = useQuery({
    queryKey: signerQueryKeys.list(tenantId),
    queryFn: async ({ signal }) => {
      const resp = await customFetch<SignerListResponse>({
        url: signersBaseUrl(tenantId),
        method: 'GET',
        signal,
      });
      return resp.items.map(daemonToSigner);
    },
    staleTime: 30_000,
  });

  const signers = data ?? [];

  if (filter === undefined) return signers;

  const search = filter.search.toLowerCase().trim();
  return signers.filter((s) => {
    if (filter.statuses.length > 0 && !filter.statuses.includes(s.status)) return false;
    if (search) {
      const nameMatch = s.name.toLowerCase().includes(search);
      const fpMatch = s.fingerprint.toLowerCase().includes(search);
      if (!nameMatch && !fpMatch) return false;
    }
    return true;
  });
}

export function useSignerDetail(
  id: string,
  tenantId: string | null = null,
): PluginSigner | undefined {
  const { data } = useQuery({
    queryKey: signerQueryKeys.detail(tenantId, id),
    queryFn: async ({ signal }) => {
      const resp = await customFetch<DaemonSigner>({
        url: `${signersBaseUrl(tenantId)}/${id}`,
        method: 'GET',
        signal,
      });
      return daemonToSigner(resp);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
  return data;
}

/** Plugins signed by a given signer — fetched from the daemon's sub-collection. */
export function useSignerPlugins(id: string, tenantId: string | null = null): Plugin[] {
  const { data } = useQuery({
    queryKey: signerQueryKeys.plugins(id),
    queryFn: async ({ signal }) => {
      const resp = await customFetch<PluginListResponse>({
        url: `${signersBaseUrl(tenantId)}/${id}/plugins`,
        method: 'GET',
        signal,
      });
      return resp.items.map(daemonToPlugin);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
  return data ?? [];
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createSigner(input: CreateSignerInput): Promise<PluginSigner> {
  const resp = await customFetch<DaemonSigner>({
    url: signersBaseUrl(input.tenant_scope),
    method: 'POST',
    data: {
      name: input.name,
      fingerprint: input.fingerprint,
      notes: input.description ?? '',
    },
  });
  return daemonToSigner(resp);
}

export async function updateSigner(
  id: string,
  input: UpdateSignerInput,
  tenantId: string | null = null,
): Promise<PluginSigner> {
  const resp = await customFetch<DaemonSigner>({
    url: `${signersBaseUrl(tenantId)}/${id}`,
    method: 'PUT',
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.fingerprint !== undefined ? { fingerprint: input.fingerprint } : {}),
      ...(input.description !== undefined ? { notes: input.description } : {}),
    },
  });
  return daemonToSigner(resp);
}

export async function deleteSigner(id: string, tenantId: string | null = null): Promise<void> {
  await customFetch<unknown>({
    url: `${signersBaseUrl(tenantId)}/${id}`,
    method: 'DELETE',
  });
}

export async function verifySigner(
  id: string,
  tenantId: string | null = null,
): Promise<PluginSigner> {
  const resp = await customFetch<DaemonSigner>({
    url: `${signersBaseUrl(tenantId)}/${id}/verify`,
    method: 'POST',
  });
  return daemonToSigner(resp);
}

export async function revokeSigner(
  id: string,
  tenantId: string | null = null,
): Promise<PluginSigner> {
  const resp = await customFetch<DaemonSigner>({
    url: `${signersBaseUrl(tenantId)}/${id}/revoke`,
    method: 'POST',
  });
  return daemonToSigner(resp);
}

// ─── TanStack Query mutation hooks ───────────────────────────────────────────

export function useCreateSignerMutation(tenantId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSignerInput) => createSigner(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: signerQueryKeys.list(tenantId) });
    },
  });
}

export function useUpdateSignerMutation(tenantId: string | null, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSignerInput) => updateSigner(id, input, tenantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: signerQueryKeys.list(tenantId) });
      void qc.invalidateQueries({ queryKey: signerQueryKeys.detail(tenantId, id) });
    },
  });
}

export function useDeleteSignerMutation(tenantId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSigner(id, tenantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: signerQueryKeys.list(tenantId) });
    },
  });
}

export function useVerifySignerMutation(tenantId: string | null, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => verifySigner(id, tenantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: signerQueryKeys.list(tenantId) });
      void qc.invalidateQueries({ queryKey: signerQueryKeys.detail(tenantId, id) });
    },
  });
}

export function useRevokeSignerMutation(tenantId: string | null, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => revokeSigner(id, tenantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: signerQueryKeys.list(tenantId) });
      void qc.invalidateQueries({ queryKey: signerQueryKeys.detail(tenantId, id) });
    },
  });
}
