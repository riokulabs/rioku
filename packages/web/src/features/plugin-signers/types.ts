/**
 * Feature-local types for plugin signers (Plan 6).
 */
export type { PluginSigner, Plugin, ID } from '@/api/resources/types';

import type { PluginSigner } from '@/api/resources/types';

/** List filter for the signers table. */
export interface SignerFilter {
  search: string;
  /** Selected statuses. Empty array = no status filter. */
  statuses: PluginSigner['status'][];
}

export interface CreateSignerInput {
  /** null = global signer (super-admin only); otherwise tenant-scoped. */
  tenant_scope: string | null;
  name: string;
  fingerprint: string;
  description?: string;
  /** Status at creation — defaults to 'pending' in the API. */
  status?: PluginSigner['status'];
}

export interface UpdateSignerInput {
  name?: string;
  description?: string;
  /** Fingerprint rotation is allowed; the API records an audit entry with diff. */
  fingerprint?: string;
}

/**
 * Error thrown when attempting to delete a signer that still has plugins
 * referencing it. Callers must revoke or reassign those plugins first.
 */
export class SignerInUseError extends Error {
  readonly code = 'SIGNER_IN_USE';
  readonly pluginIds: string[];
  constructor(pluginIds: string[]) {
    super(
      `Signer cannot be deleted — ${String(pluginIds.length)} plugin(s) reference it.`,
    );
    this.name = 'SignerInUseError';
    this.pluginIds = pluginIds;
  }
}
