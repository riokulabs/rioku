// Owned by Plan 09 (plugins) — types for the plugins resource surface.

import type { ID } from './common';

export interface Plugin {
  readonly id: ID;
  /** null = global/super-admin scope */
  tenant_scope: ID | null;
  slug: string;
  display_name: string;
  version: string;
  enabled: boolean;
  parts: ('daemon' | 'caddy' | 'admin')[];
  declared_permissions: string[];
  manifest: unknown;
  has_errors: boolean;
  // New in Plan 6:
  /** Build/swap state. 'stable' = latest published; 'building' = install in progress; 'failed' = last install failed. */
  build_state: 'stable' | 'building' | 'failed';
  /** Captured stdout/stderr for failed builds. */
  last_build_log?: string;
  /** FK to PluginSigner.id — who signed this plugin. Optional (unsigned / dev-mode). */
  signer_id?: ID;
  /** Stage-1 mock — cosign verification outcome. */
  cosign_verified: boolean;
  /** Opaque SBOM URI (e.g. oci://..., https://...). */
  sbom_uri?: string;
}

export interface MarketplaceListing {
  readonly id: ID;
  slug: string;
  display_name: string;
  author: string;
  description: string;
  version: string;
  tags: string[];
  installs: number;
  verified: boolean;
}
