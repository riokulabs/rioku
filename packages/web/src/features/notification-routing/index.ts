/**
 * Notification routing rules feature — barrel exports.
 */
export {
  useRoutingRuleList,
  useRoutingRuleDetail,
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  reorderRoutingRules,
} from './api';

export {
  EVENT_FILTER_REGEX,
  eventFilterSchema,
  createRoutingRuleSchema,
  updateRoutingRuleSchema,
} from './schemas';

export type {
  CreateRoutingRuleFormValues,
  UpdateRoutingRuleFormValues,
} from './schemas';

export type {
  CreateRoutingRuleInput,
  NotificationRoutingRule,
  RoutingRuleFilter,
  UpdateRoutingRuleInput,
} from './types';
