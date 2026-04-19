/**
 * Plugin manifest validator — spec §9.2 + §9.6.1.
 *
 * Two-stage validation:
 *   1. Structural: parsed through `manifestSchema` (Zod).
 *   2. Semantic: reserved-prefix check, privilege-escalation warning.
 *
 * Returns a discriminated union. Warnings are non-fatal; a manifest with
 * warnings still passes (ok: true) but the host should surface them.
 */

import { manifestSchema, type PluginManifest } from './manifest-schema';
import { isReservedPermission } from './permissions';

// ─── Result type ──────────────────────────────────────────────────────────────

export type ManifestValidationResult =
  | { ok: true; manifest: PluginManifest; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

// ─── Privileged role identifiers that trigger a warning ──────────────────────

const PRIVILEGED_ROLES = ['admin', 'super-admin', 'root', 'superuser', 'owner'] as const;

// ─── Main validator ───────────────────────────────────────────────────────────

export function validateManifest(raw: unknown): ManifestValidationResult {
  const warnings: string[] = [];

  // ── Stage 1: structural parse ───────────────────────────────────────────────
  const parsed = manifestSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    });
    return { ok: false, errors, warnings };
  }

  const manifest = parsed.data;
  const errors: string[] = [];

  // ── Stage 2: semantic checks ────────────────────────────────────────────────
  for (const perm of manifest.permissions) {
    // Rule §9.6.1 rule 3: reserved-prefix rejection.
    if (isReservedPermission(perm.key)) {
      errors.push(`permission "${perm.key}" uses reserved built-in prefix`);
    }

    // Double-check: key must contain at least one '.' before ':'.
    // The schema regex already enforces this, but be defensive.
    const colonIdx = perm.key.indexOf(':');
    if (colonIdx !== -1) {
      const namespace = perm.key.slice(0, colonIdx);
      if (!namespace.includes('.')) {
        errors.push(
          `permission "${perm.key}": namespace before ':' must be a reverse-DNS identifier (e.g. "com.acme.plugin")`,
        );
      }
    }

    // Privilege-escalation warning: default_roles includes a privileged identifier.
    for (const role of perm.default_roles ?? []) {
      if ((PRIVILEGED_ROLES as readonly string[]).includes(role)) {
        warnings.push(
          `permission "${perm.key}" declares default_role "${role}" — granting to privileged roles by default may be a privilege-escalation risk; review carefully`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return { ok: true, manifest, warnings };
}
