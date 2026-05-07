/**
 * Plugin manifest validator — daemon-backed (Stage 2, Plan 09 T3).
 *
 * Posts a candidate manifest JSON to
 *   POST /api/v1/t/{tenant}/plugins/manifest/validate
 * and returns `{valid, errors[]}`. The daemon uses a stdlib hand-validator
 * (see packages/daemon/internal/plugins/plugins.go::ValidateManifest) — no
 * external schema runtime dependency is shipped to either side.
 *
 * Used by the sideload form, the install-by-reference manifest preview,
 * and the JSON-paste import wizard.
 */
import { useMutation } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';

/** Single field-level validation error returned by the daemon. */
export interface ManifestValidationError {
  /** JSON pointer to the offending field (e.g. "name", "permissions[2]"). */
  path: string;
  /** Human-readable message — safe to render directly to the operator. */
  message: string;
}

/** Result envelope returned by the validate endpoint. */
export interface ManifestValidationResult {
  valid: boolean;
  errors: ManifestValidationError[];
}

/**
 * Posts the manifest to the daemon and returns the result. Network or
 * permission failures bubble as ApiError; only field-level validation
 * failures populate `errors[]`.
 */
export async function validateManifest(
  tenantSlug: string,
  manifest: Record<string, unknown>,
): Promise<ManifestValidationResult> {
  return customFetch<ManifestValidationResult>({
    url: `/t/${encodeURIComponent(tenantSlug)}/plugins/manifest/validate`,
    method: 'POST',
    data: manifest,
  });
}

/**
 * React-Query mutation wrapper. The mutation key is keyed on the tenant slug
 * so independent tenants don't share inflight state.
 */
export function useValidateManifest(tenantSlug: string) {
  return useMutation({
    mutationKey: ['plugin-manifest-validate', tenantSlug],
    mutationFn: (manifest: Record<string, unknown>) => validateManifest(tenantSlug, manifest),
  });
}
