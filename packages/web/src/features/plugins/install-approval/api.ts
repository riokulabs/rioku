/**
 * Install-approval API — `installPlugin` posts to the real daemon endpoint
 * `POST /api/v1/t/{tenant}/plugins` and returns the resulting Plugin.
 *
 * Also exports permission-risk helpers used by the modal to decide
 * whether a second-confirm checkbox is required.
 */
import { installPlugin as orvalInstallPlugin } from '@/api/generated/plugins/plugins';
import type { Plugin } from '@/api/resources';
import type { ApprovalCandidate } from './types';

// ─── Permission risk heuristics ──────────────────────────────────────────────

/**
 * A permission key is "admin-level" — requiring a second confirmation — if it:
 *   - starts with `admin:`
 *   - matches `rioku:*:write` or `rioku:*:delete`
 *   - is the global wildcard `*:*:*`
 *
 * Plugin-namespaced writes (e.g. `com.acme.foo:write`) are NOT treated as
 * admin-level — only built-in rioku namespaces carry cross-tenant risk.
 */
export function isAdminLevelPermission(key: string): boolean {
  if (key === '*:*:*') return true;
  if (key.startsWith('admin:')) return true;
  // rioku:<something>:write | :delete
  if (/^rioku:[^:]+:(write|delete)$/.test(key)) return true;
  return false;
}

/** Returns the admin-level subset (preserving order) of declared permissions. */
export function adminLevelPermissions(declared: string[]): string[] {
  return declared.filter(isAdminLevelPermission);
}

// ─── Installer ───────────────────────────────────────────────────────────────

interface DaemonPluginResponse {
  id?: string;
  slug?: string;
  name?: string;
  display_name?: string;
  version?: string;
  enabled?: boolean;
  tenantScope?: string | null;
  buildState?: string;
  cosignVerified?: boolean;
}

function adaptInstalled(
  resp: DaemonPluginResponse,
  candidate: ApprovalCandidate,
  tenantId: string,
): Plugin {
  return {
    id: resp.id ?? `plugin-${candidate.slug}`,
    tenant_scope: resp.tenantScope ?? tenantId,
    slug: resp.slug ?? candidate.slug,
    display_name: resp.display_name ?? resp.name ?? candidate.display_name,
    version: resp.version ?? candidate.version,
    enabled: resp.enabled ?? true,
    parts: candidate.parts,
    declared_permissions: candidate.declared_permissions,
    manifest: candidate.manifest ?? { slug: candidate.slug, version: candidate.version },
    has_errors: false,
    build_state:
      resp.buildState !== undefined ? (resp.buildState as Plugin['build_state']) : 'stable',
    cosign_verified: resp.cosignVerified ?? true,
  };
}

/**
 * Install a plugin from an approval candidate. Posts the candidate to the
 * tenant-scoped install endpoint and adapts the response back into the
 * admin Plugin shape.
 */
export async function installPlugin(
  tenantId: string,
  candidate: ApprovalCandidate,
): Promise<Plugin> {
  const wrapped = await orvalInstallPlugin(tenantId, {
    name: candidate.display_name,
    slug: candidate.slug,
    version: candidate.version,
  });
  // customFetch (orval form) returns {data, status, headers}; unwrap.
  const body = (wrapped as unknown as { data: DaemonPluginResponse }).data;
  return adaptInstalled(body, candidate, tenantId);
}
