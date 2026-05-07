/**
 * AI Tools — daemon-backed hooks (T4 wiring).
 *
 * Re-exports Orval-generated hooks for `/api/v1/t/{tenant}/ai/tools/...`.
 */
export {
  useListAITools as useToolList,
  useGetAITool as useToolDetail,
  useCreateAITool as useCreateTool,
  useUpdateAITool as useUpdateTool,
  usePatchAITool as usePatchTool,
  useDeleteAITool as useDeleteTool,
  useTestAITool as useTestTool,
  useListAIToolAgents as useToolAgents,
  // Imperative variants
  listAITools,
  getAITool,
  createAITool,
  updateAITool,
  patchAITool,
  deleteAITool,
  testAITool,
  listAIToolAgents,
} from '@/api/generated/ai-tools/ai-tools';

export type {
  AITool,
  AIToolCreateRequest,
  AIToolUpdateRequest,
} from '@/api/generated/schemas';
