/**
 * Install-by-reference types.
 *
 * The three sub-forms produce an InstallCandidate which is handed to the
 * install-approval modal. Only minimal fields are filled — the approval
 * flow does NOT need the full Plugin record.
 */
export interface InstallCandidate {
  slug: string;
  display_name: string;
  version: string;
  source: 'oci' | 'tarball' | 'manifest-url';
  /** Human-readable reference string (for display in the approval UI). */
  reference: string;
  /** Optional signer fingerprint or author (shown in the approval UI). */
  signer?: string;
  declared_permissions: string[];
  parts: ('daemon' | 'caddy' | 'admin')[];
  /** Optional structured manifest stub — may carry zones / api_scopes. */
  manifest?: unknown;
}
