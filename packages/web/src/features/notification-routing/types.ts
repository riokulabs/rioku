/**
 * Feature-local types for the notification-routing feature.
 */
import type { ID, NotificationRoutingRule } from '@/api/resources/types';

export type { ID, NotificationRoutingRule };

export interface RoutingRuleFilter {
  /** undefined = both; true = only enabled; false = only disabled. */
  enabled: boolean | undefined;
  /** Case-insensitive substring match against name or event_filter. */
  search: string;
}

export interface CreateRoutingRuleInput {
  tenant_id: ID;
  name: string;
  event_filter: string;
  channel_ids: ID[];
  enabled?: boolean;
  order_hint?: number;
}

export type UpdateRoutingRuleInput = Partial<Omit<CreateRoutingRuleInput, 'tenant_id'>>;
