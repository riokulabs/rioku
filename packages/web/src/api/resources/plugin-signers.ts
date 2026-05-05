// Owned by Plan 09 (plugins) — types for the plugin-signers resource surface.

import type { ID } from './common';

/**
 * PluginSigner — identity of a party authorised to sign plugins.
 *
 * Plan 6 stage-1 mock surface. In stage 2+ this maps to the cosign/TUF root
 * allow-list enforced by the daemon.
 */
export interface PluginSigner {
  readonly id: ID;
  /** null = global (super-admin-only); otherwise tenant-scoped. */
  tenant_scope: ID | null;
  name: string;
  /** SHA-256 hex fingerprint (64 lowercase hex chars). */
  fingerprint: string;
  /** 'verified' = cosign-valid, 'revoked' = explicitly denied, 'pending' = awaiting review. */
  status: 'verified' | 'revoked' | 'pending';
  description?: string;
  readonly created_at: string;
}
