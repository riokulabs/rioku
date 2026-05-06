/**
 * AI Semantic Rate Limits feature — barrel exports.
 */
export {
  useRateLimitList,
  useRateLimitDetail,
  createRateLimit,
  updateRateLimit,
  deleteRateLimit,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy shim, see ./api.ts
  simulateMatch,
  simulateRateLimitProbe,
  useSimulateRateLimitProbeMutation,
  useCreateRateLimitMutation,
  useUpdateRateLimitMutation,
  useDeleteRateLimitMutation,
  useRateLimitMetrics,
  useRateLimitMetricsRaw,
} from './api';

export { createRateLimitSchema, updateRateLimitSchema } from './schemas';
export type { CreateRateLimitFormValues, UpdateRateLimitFormValues } from './schemas';

export type {
  RateLimitFilter,
  CreateRateLimitInput,
  UpdateRateLimitInput,
  SimulateMatchResult,
  SimulateProbeInput,
  SimulateProbeResult,
  MetricWindow,
  RateLimitMetricsPoint,
} from './types';

export { RateLimitList } from './components/list';
export { RateLimitFilterBar } from './components/filter-bar';
export { RateLimitForm } from './components/form';
export { RateLimitDetail } from './components/detail';
export { MetricsSparkline } from './components/metrics-sparkline';
export { RateLimitMetricsChart } from './components/metrics-chart';
export { Simulator } from './components/simulator';
export { RateLimitDrawer } from './components/drawer';
export { RateLimitFullPage } from './components/full-page';
