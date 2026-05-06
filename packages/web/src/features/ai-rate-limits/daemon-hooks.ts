/**
 * AI Rate-Limits — daemon-backed hooks (T6 wiring).
 *
 * Re-exports Orval-generated hooks for `/api/v1/t/{tenant}/ai/rate-limits/...`.
 * Includes simulate + metrics action endpoints.
 */
export {
  useListAIRateLimits as useRateLimitList,
  useGetAIRateLimit as useRateLimitDetail,
  useCreateAIRateLimit as useCreateRateLimit,
  useUpdateAIRateLimit as useUpdateRateLimit,
  useDeleteAIRateLimit as useDeleteRateLimit,
  useSimulateAIRateLimit as useSimulateRateLimit,
  useGetAIRateLimitMetrics as useRateLimitMetrics,
  // Imperative variants
  listAIRateLimits,
  getAIRateLimit,
  createAIRateLimit,
  updateAIRateLimit,
  deleteAIRateLimit,
  simulateAIRateLimit,
  getAIRateLimitMetrics,
} from '@/api/generated/ai-rate-limits/ai-rate-limits';

export type {
  AIRateLimit,
  AIRateLimitCreateRequest,
  AIRateLimitSimulateRequest,
  AIRateLimitUpdateRequest,
  GetAIRateLimitMetrics200,
  AIRateLimitMetricsPoint,
  SimulateAIRateLimit200,
} from '@/api/generated/schemas';
