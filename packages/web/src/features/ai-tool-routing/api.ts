/**
 * AI Tool Routing (bindings) API — wired to the real daemon (stage-2).
 *
 * Public names:
 *   - useBindingList
 *   - useBindingDetail
 *   - createBinding
 *   - updateBinding
 *   - deleteBinding
 *   - bulkAttachToolsToAgent
 *   - previewCondition
 *
 * Endpoints are accessed through the Orval-generated client at
 * `@/api/generated/ai-tool-bindings/ai-tool-bindings`. Hooks compose
 * `useListAIToolBindings` / `useGetAIToolBinding` for queries and the
 * imperative `createAIToolBinding` / `updateAIToolBinding` /
 * `deleteAIToolBinding` / `bulkAttachAIToolBindings` /
 * `previewAIToolBindingCondition` functions for mutations and the
 * CEL preview surface.
 *
 * The daemon's wire format uses camelCase (`agentId`, `toolId`,
 * `createdAt`, ...). The admin-panel uses snake_case
 * (`agent_id`, `tool_id`, `created_at`) per the existing
 * `AiToolBinding` resource type. Adapter helpers in this file
 * translate between the two.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAIToolBindings,
  getAIToolBinding,
  createAIToolBinding,
  updateAIToolBinding,
  deleteAIToolBinding,
  bulkAttachAIToolBindings,
  previewAIToolBindingCondition,
} from '@/api/generated/ai-tool-bindings/ai-tool-bindings';
import type {
  AIToolBinding as WireBinding,
} from '@/api/generated/schemas';
import type { AiToolBinding } from '@/api/resources';
import type {
  BindingFilter,
  CreateBindingInput,
  PreviewConditionResult,
  UpdateBindingInput,
} from './types';

// ─── Query key factory ────────────────────────────────────────────────────────

export const bindingKeys = {
  all: (tenant: string) => ['ai-tool-bindings', tenant] as const,
  list: (tenant: string) => ['ai-tool-bindings', tenant, 'list'] as const,
  detail: (tenant: string, id: string) => ['ai-tool-bindings', tenant, 'detail', id] as const,
};

// ─── Wire ↔ admin-resource adapters ───────────────────────────────────────────

function fromWire(b: WireBinding): AiToolBinding {
  return {
    id: b.id,
    tenant_id: b.tenantId,
    agent_id: b.agentId,
    tool_id: b.toolId,
    condition: b.condition ?? '',
    enabled: b.enabled,
    created_at: b.createdAt,
  };
}

// ─── Selectors (query hooks) ─────────────────────────────────────────────────

/**
 * Fetch all bindings for a tenant and filter client-side. The daemon's list
 * endpoint does not currently expose agent/tool/enabled/has_condition
 * predicates so we do them here.
 */
export function useBindingList(tenantId: string, filter: BindingFilter): AiToolBinding[] {
  const { data } = useQuery({
    queryKey: bindingKeys.list(tenantId),
    queryFn: async () => {
      const res = await listAIToolBindings(tenantId);
      const items = res.data.items ?? [];
      return items.map(fromWire);
    },
    enabled: tenantId.length > 0,
  });

  return useMemo(() => {
    const all = data ?? [];
    return all.filter((b) => {
      if (filter.agent_ids.length > 0 && !filter.agent_ids.includes(b.agent_id)) return false;
      if (filter.tool_ids.length > 0 && !filter.tool_ids.includes(b.tool_id)) return false;
      if (filter.enabled !== undefined && b.enabled !== filter.enabled) return false;
      if (filter.has_condition !== undefined) {
        const has = b.condition.trim().length > 0;
        if (has !== filter.has_condition) return false;
      }
      return true;
    });
  }, [data, filter.agent_ids, filter.tool_ids, filter.enabled, filter.has_condition]);
}

/** Fetch a single binding by id. */
export function useBindingDetail(tenantId: string, id: string): AiToolBinding | undefined {
  const { data } = useBindingDetailQuery(tenantId, id);
  return data;
}

/**
 * Same fetch as `useBindingDetail` but exposes loading + error state. The
 * full-page route wants to distinguish "still loading" from "404".
 */
export function useBindingDetailQuery(tenantId: string, id: string): {
  data: AiToolBinding | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: bindingKeys.detail(tenantId, id),
    queryFn: async () => {
      const res = await getAIToolBinding(tenantId, id);
      return fromWire(res.data);
    },
    enabled: tenantId.length > 0 && id.length > 0,
  });
  return { data, isLoading, isError };
}

// ─── Mutations (imperative — used inside async event handlers) ───────────────

export async function createBinding(
  tenantId: string,
  input: CreateBindingInput,
): Promise<AiToolBinding> {
  const res = await createAIToolBinding(tenantId, {
    agentId: input.agent_id,
    toolId: input.tool_id,
    condition: input.condition,
  });
  return fromWire(res.data);
}

export async function updateBinding(
  tenantId: string,
  id: string,
  input: UpdateBindingInput,
): Promise<AiToolBinding> {
  const body: { condition?: string; enabled?: boolean } = {};
  if (input.condition !== undefined) body.condition = input.condition;
  if (input.enabled !== undefined) body.enabled = input.enabled;
  const res = await updateAIToolBinding(tenantId, id, body);
  return fromWire(res.data);
}

export async function deleteBinding(tenantId: string, id: string): Promise<void> {
  await deleteAIToolBinding(tenantId, id);
}

/**
 * Bulk-attach helper. Daemon accepts `(tenant, { agentId, toolIds })` and
 * returns `{ items, total }`. Public name preserved; tenant is now required
 * (it was implicit before via the mock store).
 */
export async function bulkAttachToolsToAgent(
  tenantId: string,
  agentId: string,
  toolIds: string[],
): Promise<AiToolBinding[]> {
  const res = await bulkAttachAIToolBindings(tenantId, {
    agentId,
    toolIds,
  });
  return (res.data.items ?? []).map(fromWire);
}

// ─── CEL preview ─────────────────────────────────────────────────────────────

/**
 * Preview a CEL condition against a sample envelope. Calls the daemon's
 * `/api/v1/t/{tenant}/ai/tool-bindings/preview-condition` endpoint, which
 * uses the same cel-go evaluator that runs at request time. Empty string
 * is treated as "always allow" without a network call.
 *
 * The result shape `{ parses, sample_result?, error? }` is preserved across
 * existing callers (the form, the drawer, the full page). The daemon shape
 * is `{ matched?, condition?, note? }` and is mapped here. Daemon-side parse / evaluation errors surface as a thrown
 * `ApiError` from `customFetch`, which we catch here and translate.
 */
export async function previewCondition(
  tenantId: string,
  condition: string,
  sampleEnvelope: Record<string, unknown>,
): Promise<PreviewConditionResult> {
  if (!condition.trim()) {
    return { parses: true, sample_result: true };
  }
  try {
    const res = await previewAIToolBindingCondition(tenantId, {
      condition,
      envelope: sampleEnvelope,
    });
    return {
      parses: true,
      sample_result: res.data.matched ?? false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Preview failed';
    return { parses: false, error: msg };
  }
}

// ─── Cache invalidation helper for mutating components ───────────────────────

/**
 * Invalidate every binding-related query for a tenant. Components call this
 * after a successful mutation so the next render reflects the new server
 * state without forcing them to manage individual query keys.
 */
export function useInvalidateBindings(tenantId: string): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: bindingKeys.all(tenantId) });
  };
}
