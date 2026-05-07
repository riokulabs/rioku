/**
 * Sessions feature — barrel exports.
 *
 * RD5: sessions are inline-only — no drawer, no full-page detail.
 */
export { SessionList } from './components/list';
export {
  useSessionList,
  useSessionMutations,
  revokeSession,
  revokeAllOtherSessions,
  parseDevice,
} from './api';
export type { SessionWithMeta } from './types';
