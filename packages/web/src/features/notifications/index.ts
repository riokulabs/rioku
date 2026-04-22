/**
 * Notifications feature — barrel exports.
 *
 * Stage 1: inbox selectors, mutations, streaming tail, emit helper.
 * UI components land in Phase 7b + 7c.
 */
export {
  useNotificationList,
  useNotificationListInfinite,
  useNotificationDetail,
  useUnreadCount,
  markRead,
  markAllRead,
  archive,
  unarchive,
  subscribeInboxStream,
  emitNotification,
} from './api';

export type { NotificationListInfiniteResult } from './api';

export {
  inboxFilterSchema,
  emitNotificationInputSchema,
  severitySchema,
  actionSchema,
  categorySchema,
  BUILT_IN_CATEGORIES,
  PLUGIN_CATEGORY_REGEX,
  PLUGIN_SLUG_REGEX,
} from './schemas';

export type { InboxFilterFormValues, EmitNotificationFormValues } from './schemas';

export type {
  EmitNotificationInput,
  InboxFilter,
  InboxStreamListener,
  NotificationAction,
  NotificationItem,
} from './types';

export { InboxDropdown } from './components/inbox-dropdown';
export { NotificationDetail } from './components/detail';
export { NotificationFilterBar, type ReadFilter } from './components/filter-bar';
export { NotificationList } from './components/list';
