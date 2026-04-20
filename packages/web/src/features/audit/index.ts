/**
 * Audit feature — barrel exports.
 *
 * Stage 1: read-only API, streaming tail, async-search, export helpers,
 * retention-config CRUD. UI components land in Phase 5b + 5c.
 */
export {
  useAuditList,
  useAuditListInfinite,
  useAuditDetail,
  subscribeAuditStream,
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

export {
  auditFilterSchema,
  retentionConfigSchema,
} from './schemas';
export type {
  AuditFilterFormValues,
  RetentionConfigFormValues,
} from './schemas';

export type {
  ActorCandidate,
  AsyncSearchPage,
  AuditEntry,
  AuditFilter,
  AuditListInfiniteResult,
  AuditRetentionConfig,
  AuditStreamListener,
  ResourceIdCandidate,
  UpdateRetentionConfigInput,
} from './types';

export { CelDiff } from './components/cel-diff';
export type { CelDiffProps } from './components/cel-diff';

export { AuditList } from './components/list';
export type { AuditListProps } from './components/list';

export { AuditFilterBar } from './components/filter-bar';
export type { AuditFilterBarProps } from './components/filter-bar';
