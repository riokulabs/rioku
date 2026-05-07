/**
 * AI Agents — daemon-backed hooks (T3 wiring).
 *
 * Re-exports the Orval-generated hooks under feature-friendly names. These call
 * `/api/v1/t/{tenant}/ai/agents/...` directly via the customFetch mutator.
 * Callers that opt into stage-2 real-mode import from here; the legacy
 * mock-store path in `./api.ts` remains for stage-1 mock-mode.
 *
 * Daemon shape uses camelCase (see `AIAgent` in `@/api/generated/schemas/aIAgent`).
 */
export {
  useListAIAgents as useAgentList,
  useGetAIAgent as useAgentDetail,
  useCreateAIAgent as useCreateAgent,
  useUpdateAIAgent as useUpdateAgent,
  usePatchAIAgent as usePatchAgent,
  useDeleteAIAgent as useDeleteAgent,
  useRotateAIAgentCredential as useRotateAgentCredential,
  useListAIAgentTools as useAgentTools,
  useListAIAgentTraces as useAgentTraces,
  // Imperative variants
  listAIAgents,
  getAIAgent,
  createAIAgent,
  updateAIAgent,
  patchAIAgent,
  deleteAIAgent,
  rotateAIAgentCredential,
  listAIAgentTools,
  listAIAgentTraces,
} from '@/api/generated/ai-agents/ai-agents';

export type {
  AIAgent,
  AIAgentCreateRequest,
  AIAgentUpdateRequest,
} from '@/api/generated/schemas';
