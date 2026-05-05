/**
 * Feature-local types for sessions.
 */
export type { Session, ID } from '@/api/resources';

import type { Session } from '@/api/resources';

/** Enriched session with parsed device + geo stub */
export interface SessionWithMeta extends Session {
  /** Parsed device name from user-agent */
  device: string;
  /** Geo-stub location from IP (hardcoded stage-1 mapping) */
  location: string;
  /** Relative "last seen" string */
  last_seen_relative: string;
  /** Whether this is the current session */
  is_current: boolean;
}
