/**
 * AI Providers API — wired to the real daemon via TanStack Query + customFetch.
 *
 * All hooks call /api/v1/t/:tenant/ai/providers (and sub-routes).
 * Tests use MSW handlers defined in __tests__/msw-handlers.ts.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import type { AiProvider } from '@/api/resources';
import type {
  AddModelInput,
  CreateProviderInput,
  ProviderFilter,
  TestProviderResult,
  UpdateModelInput,
  UpdateProviderInput,
} from './types';

// ─── Query key factory ────────────────────────────────────────────────────────

export const providerKeys = {
  all: (tenant: string) => ['ai-providers', tenant] as const,
  list: (tenant: string, filter?: ProviderFilter) =>
    ['ai-providers', tenant, 'list', filter] as const,
  detail: (tenant: string, id: string) => ['ai-providers', tenant, 'detail', id] as const,
  agents: (tenant: string, id: string) => ['ai-providers', tenant, 'agents', id] as const,
};

// ─── API helpers ──────────────────────────────────────────────────────────────

function providerBase(tenant: string): string {
  return `/t/${tenant}/ai/providers`;
}

/**
 * Bridge daemon (camelCase, partial fields) → SPA `AiProvider` (snake_case).
 *
 * The daemon's `/api/v1/t/{tenant}/ai/providers` response emits camelCase
 * keys (`baseUrl`, `createdAt`, `updatedAt`) and does not include the
 * SPA-only `credential_ref`, `models`, `description` slots that list and
 * detail views expect. Accessing those undefined fields used to crash
 * the page into the error boundary on every load with seeded providers.
 * Map fields explicitly and supply safe defaults for the SPA-only slots.
 */
interface DaemonAiProvider {
  id: string;
  tenantId?: string;
  tenant_id?: string;
  name: string;
  kind: AiProvider['kind'];
  baseUrl?: string;
  base_url?: string;
  description?: string;
  enabled?: boolean;
  models?: AiProvider['models'];
  credentialRef?: Partial<AiProvider['credential_ref']>;
  credential_ref?: Partial<AiProvider['credential_ref']>;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
}
function adaptProvider(raw: DaemonAiProvider): AiProvider {
  const cred = raw.credentialRef ?? raw.credential_ref ?? {};
  return {
    id: raw.id,
    tenant_id: raw.tenantId ?? raw.tenant_id ?? '',
    name: raw.name,
    kind: raw.kind,
    base_url: raw.baseUrl ?? raw.base_url ?? '',
    description: raw.description ?? '',
    enabled: raw.enabled ?? true,
    models: raw.models ?? [],
    credential_ref: {
      prefix: cred.prefix ?? '',
      created_at: cred.created_at ?? raw.createdAt ?? raw.created_at ?? '',
    },
    created_at: raw.createdAt ?? raw.created_at ?? '',
    updated_at: raw.updatedAt ?? raw.updated_at ?? '',
  };
}

// ─── Selectors (query hooks) ──────────────────────────────────────────────────

/** Fetch + filter providers for a tenant. Filter applied client-side after fetch. */
export function useProviderList(tenant: string, filter: ProviderFilter): AiProvider[] {
  const { data } = useQuery({
    queryKey: providerKeys.list(tenant),
    queryFn: () =>
      customFetch<{ items: DaemonAiProvider[] }>({
        url: providerBase(tenant),
        method: 'GET',
      }),
  });

  const providers = (data?.items ?? []).map(adaptProvider);
  const search = filter.search.toLowerCase().trim();
  return providers.filter((p) => {
    if (filter.kinds.length > 0 && !filter.kinds.includes(p.kind)) return false;
    if (filter.enabled !== undefined && p.enabled !== filter.enabled) return false;
    if (search) {
      const nameMatch = p.name.toLowerCase().includes(search);
      const urlMatch = p.base_url.toLowerCase().includes(search);
      const descMatch = p.description?.toLowerCase().includes(search) ?? false;
      if (!nameMatch && !urlMatch && !descMatch) return false;
    }
    return true;
  });
}

/** Fetch a single provider by ID. */
export function useProviderDetail(tenant: string, id: string): AiProvider | undefined {
  const { data } = useQuery({
    queryKey: providerKeys.detail(tenant, id),
    queryFn: () =>
      customFetch<DaemonAiProvider>({
        url: `${providerBase(tenant)}/${id}`,
        method: 'GET',
      }),
    enabled: Boolean(id),
  });
  return data ? adaptProvider(data) : undefined;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateProvider(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProviderInput) =>
      customFetch<AiProvider>({
        url: providerBase(tenant),
        method: 'POST',
        data: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.all(tenant) });
    },
  });
}

export function useUpdateProvider(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProviderInput }) =>
      customFetch<AiProvider>({
        url: `${providerBase(tenant)}/${id}`,
        method: 'PUT',
        data: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.all(tenant) });
    },
  });
}

export function useDeleteProvider(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      customFetch<unknown>({
        url: `${providerBase(tenant)}/${id}`,
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.all(tenant) });
    },
  });
}

export function useTestProvider(tenant: string) {
  return useMutation({
    mutationFn: (id: string) =>
      customFetch<TestProviderResult>({
        url: `${providerBase(tenant)}/${id}/test`,
        method: 'POST',
      }),
  });
}

// ─── Model management ────────────────────────────────────────────────────────

export function useAddModel(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, model }: { providerId: string; model: AddModelInput }) =>
      customFetch<AiProvider>({
        url: `${providerBase(tenant)}/${providerId}/models`,
        method: 'POST',
        data: model,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.all(tenant) });
    },
  });
}

export function useUpdateModel(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      providerId,
      upstreamId,
      patch,
    }: {
      providerId: string;
      upstreamId: string;
      patch: UpdateModelInput;
    }) =>
      customFetch<AiProvider>({
        url: `${providerBase(tenant)}/${providerId}/models/${upstreamId}`,
        method: 'PUT',
        data: patch,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.all(tenant) });
    },
  });
}

export function useRemoveModel(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, upstreamId }: { providerId: string; upstreamId: string }) =>
      customFetch<AiProvider>({
        url: `${providerBase(tenant)}/${providerId}/models/${upstreamId}`,
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.all(tenant) });
    },
  });
}

// ─── Legacy imperative API (used by components that haven't been updated yet) ──
// These wrappers call customFetch directly so they can be awaited in event handlers.

export async function createProvider(
  tenant: string,
  input: CreateProviderInput,
): Promise<AiProvider> {
  return customFetch<AiProvider>({
    url: providerBase(tenant),
    method: 'POST',
    data: input,
  });
}

export async function updateProvider(
  tenant: string,
  id: string,
  input: UpdateProviderInput,
): Promise<AiProvider> {
  return customFetch<AiProvider>({
    url: `${providerBase(tenant)}/${id}`,
    method: 'PUT',
    data: input,
  });
}

export async function deleteProvider(tenant: string, id: string): Promise<void> {
  await customFetch<unknown>({
    url: `${providerBase(tenant)}/${id}`,
    method: 'DELETE',
  });
}

export async function testProvider(tenant: string, id: string): Promise<TestProviderResult> {
  return customFetch<TestProviderResult>({
    url: `${providerBase(tenant)}/${id}/test`,
    method: 'POST',
  });
}

export async function addModel(
  tenant: string,
  providerId: string,
  model: AddModelInput,
): Promise<AiProvider> {
  return customFetch<AiProvider>({
    url: `${providerBase(tenant)}/${providerId}/models`,
    method: 'POST',
    data: model,
  });
}

export async function updateModel(
  tenant: string,
  providerId: string,
  upstreamId: string,
  patch: UpdateModelInput,
): Promise<AiProvider> {
  return customFetch<AiProvider>({
    url: `${providerBase(tenant)}/${providerId}/models/${upstreamId}`,
    method: 'PUT',
    data: patch,
  });
}

export async function removeModel(
  tenant: string,
  providerId: string,
  upstreamId: string,
): Promise<AiProvider> {
  return customFetch<AiProvider>({
    url: `${providerBase(tenant)}/${providerId}/models/${upstreamId}`,
    method: 'DELETE',
  });
}
