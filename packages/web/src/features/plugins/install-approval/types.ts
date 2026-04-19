/**
 * Install-approval types.
 */
export type { Plugin, ID } from '@/api/resources/types';

/**
 * Minimal shape the approval modal needs to render.
 *
 * Accepts either a full marketplace listing or the in-progress
 * `InstallCandidate` produced by the install-by-reference forms.
 */
export interface ApprovalCandidate {
  slug: string;
  display_name: string;
  version: string;
  signer?: string;
  declared_permissions: string[];
  parts: ('daemon' | 'caddy' | 'admin')[];
  /** Free-form reference string — shown verbatim in the identity section. */
  reference?: string;
  /** Optional manifest; `zones` and `api_scopes` are extracted if present. */
  manifest?: unknown;
}
