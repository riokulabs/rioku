/**
 * Audit feature — barrel exports.
 *
 * Stage 2: list/detail/search/export/retention all backed by mock store
 * (pending real daemon flip). Live tail via `useAuditStream` (SSE).
 */
export {
  useAuditList,
  useAuditListInfinite,
  useAuditDetail,
  exportAuditCsv,
  exportAuditJsonl,
  searchActors,
  searchResourceIds,
  useRetentionConfig,
  updateRetentionConfig,
  encodeActorHandle,
  decodeActorHandle,
  encodeResourceHandle,
  decodeResourceHandle,
} from './api';

export { auditFilterSchema, retentionConfigSchema } from './schemas';
export type { AuditFilterFormValues, RetentionConfigFormValues } from './schemas';

export type {
  ActorCandidate,
  AsyncSearchPage,
  AuditEntry,
  AuditFilter,
  AuditListInfiniteResult,
  AuditRetentionConfig,
  ResourceIdCandidate,
  UpdateRetentionConfigInput,
} from './types';

export { CelDiff } from './components/cel-diff';
export type { CelDiffProps } from './components/cel-diff';

export { AuditList } from './components/list';
export type { AuditListProps } from './components/list';

export { AuditFilterBar } from './components/filter-bar';
export type { AuditFilterBarProps } from './components/filter-bar';

export { AuditDetail } from './components/detail';
export type { AuditDetailProps } from './components/detail';

export { LiveTailBadge, useAuditStream } from './components/streaming-tail';

export { RetentionConfigForm } from './components/retention-config-form';
