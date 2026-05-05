/**
 * Install-approval API — `installPlugin` inserts into the mock store
 * and emits an audit entry + host event.
 *
 * Also exports permission-risk helpers used by the modal to decide
 * whether a second-confirm checkbox is required.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { Plugin, AuditEntry } from '@/api/resources';
import type { ApprovalCandidate } from './types';

const nextPluginId = makeIdFactory('plugin-installed');
const nextAuditId = makeIdFactory('audit-plugin-install');

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

function now(): string {
  return new Date().toISOString();
}

function currentActor(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function currentTenant(): string | null {
  return useMockStore.getState().currentTenantId;
}

/**
 * Install a plugin from an approval candidate. Adds a new Plugin to the store
 * scoped to the current tenant (stage 1 behavior: always null-scoped global
 * is fine, but we honour the current tenant so that tenant-scoped installs
 * in stage 2 drop in naturally).
 */
export async function installPlugin(candidate: ApprovalCandidate): Promise<Plugin> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const id = nextPluginId();

  const plugin: Plugin = {
    id,
    tenant_scope: currentTenant(),
    slug: candidate.slug,
    display_name: candidate.display_name,
    version: candidate.version,
    enabled: true,
    parts: candidate.parts,
    declared_permissions: candidate.declared_permissions,
    manifest: candidate.manifest ?? { slug: candidate.slug, version: candidate.version },
    has_errors: false,
    // Plan 6 additions — direct installs land as stable + cosign-verified.
    build_state: 'stable',
    cosign_verified: true,
  };
  state.addEntity('plugins', plugin);

  const audit: AuditEntry = {
    id: nextAuditId(),
    tenant_id: currentTenant(),
    actor_id: currentActor(),
    action: 'plugin:install',
    resource_type: 'plugin',
    resource_id: id,
    outcome: 'success',
    at: now(),
    tier: 'write',
  };
  state.appendAudit(audit);

  emitHostEvent('plugin:installed', {
    plugin_id: id,
    slug: plugin.slug,
    tenant_id: plugin.tenant_scope,
    source_reference: candidate.reference ?? null,
  });

  return plugin;
}
