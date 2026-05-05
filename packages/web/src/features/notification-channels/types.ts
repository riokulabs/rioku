/**
 * Feature-local types for the notification-channels feature.
 */
import type { ID, NotificationChannel } from '@/api/resources';

export type { ID, NotificationChannel };

export interface ChannelFilter {
  /** Filter by kind. Empty = all kinds. */
  kinds: NotificationChannel['kind'][];
  /** undefined = both enabled + disabled; true = only enabled; false = only disabled. */
  enabled: boolean | undefined;
  /** Case-insensitive substring match against `name`. */
  search: string;
}

export interface CreateChannelInput {
  tenant_id: ID;
  name: string;
  kind: NotificationChannel['kind'];
  config: Record<string, unknown>;
  enabled?: boolean;
}

export type UpdateChannelInput = Partial<Omit<CreateChannelInput, 'tenant_id' | 'kind'>>;

/** Result of `testChannel(id)`. */
export interface TestChannelResult {
  ok: boolean;
  latency_ms: number;
  tested_at: string;
  /** Populated only when `ok === false`. */
  error?: string;
}
