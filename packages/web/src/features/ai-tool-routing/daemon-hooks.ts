/**
 * AI Tool-Bindings (a.k.a. tool routing) — daemon-backed hooks (T5 wiring).
 *
 * Re-exports Orval-generated hooks for `/api/v1/t/{tenant}/ai/tool-bindings/...`.
 * Includes the bulk-attach action and the CEL preview-condition stub.
 */
export {
  useListAIToolBindings as useToolBindingList,
  useGetAIToolBinding as useToolBindingDetail,
  useCreateAIToolBinding as useCreateToolBinding,
  useUpdateAIToolBinding as useUpdateToolBinding,
  useDeleteAIToolBinding as useDeleteToolBinding,
  useBulkAttachAIToolBindings as useBulkAttachToolBindings,
  usePreviewAIToolBindingCondition as usePreviewToolBindingCondition,
  // Imperative variants
  listAIToolBindings,
  getAIToolBinding,
  createAIToolBinding,
  updateAIToolBinding,
  deleteAIToolBinding,
  bulkAttachAIToolBindings,
  previewAIToolBindingCondition,
} from '@/api/generated/ai-tool-bindings/ai-tool-bindings';

export type {
  AIToolBinding,
  AIToolBindingCreateRequest,
  AIToolBindingUpdateRequest,
} from '@/api/generated/schemas';
