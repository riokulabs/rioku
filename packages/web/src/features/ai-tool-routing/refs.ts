/**
 * Agent + tool reference fetchers used by the tool-binding components.
 *
 * Bindings reference agents and tools by id; the list, matrix, drawer and
 * form components all need the parent records to display friendly names.
 * Rather than calling `useListAIAgents` / `useListAITools` from the
 * generated client all over the place we centralise the loaders here and
 * map them into id → record dictionaries the components can index into.
 */
import { useQuery } from '@tanstack/react-query';
import { listAIAgents } from '@/api/generated/ai-agents/ai-agents';
import { listAITools } from '@/api/generated/ai-tools/ai-tools';
import type { AIAgent, AITool } from '@/api/generated/schemas';

export interface AgentRef {
  id: string;
  name: string;
  model: string;
}

export interface ToolRef {
  id: string;
  name: string;
  kind: string;
}

function agentRef(a: AIAgent): AgentRef {
  return { id: a.id, name: a.name, model: a.model };
}

function toolRef(t: AITool): ToolRef {
  return { id: t.id, name: t.name, kind: t.kind };
}

/** Returns agents for the tenant as both a list and a name-lookup map. */
export function useAgentRefs(tenantId: string): {
  list: AgentRef[];
  byId: Record<string, AgentRef>;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-tool-routing', 'agent-refs', tenantId],
    queryFn: async () => {
      const res = await listAIAgents(tenantId);
      return (res.data.items ?? []).map(agentRef);
    },
    enabled: tenantId.length > 0,
  });
  const list = data ?? [];
  const byId: Record<string, AgentRef> = {};
  for (const a of list) byId[a.id] = a;
  return { list, byId, isLoading };
}

/** Returns tools for the tenant as both a list and a name-lookup map. */
export function useToolRefs(tenantId: string): {
  list: ToolRef[];
  byId: Record<string, ToolRef>;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-tool-routing', 'tool-refs', tenantId],
    queryFn: async () => {
      const res = await listAITools(tenantId);
      return (res.data.items ?? []).map(toolRef);
    },
    enabled: tenantId.length > 0,
  });
  const list = data ?? [];
  const byId: Record<string, ToolRef> = {};
  for (const t of list) byId[t.id] = t;
  return { list, byId, isLoading };
}
