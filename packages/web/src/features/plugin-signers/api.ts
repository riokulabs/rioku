/**
 * Plugin signers API — backed by the Zustand mock store (Plan 6).
 *
 * Mirrors features/ai-providers/api.ts:
 *   - selectors pull stable Records and derive outside the selector body
 *   - mutations call simulateLatency + appendAudit + emitHostEvent
 *   - delete-guard throws SignerInUseError when plugins still reference
 *     the signer (mirrors ProviderInUseError)
 *
 * Stage-1 note: `verifySigner` / `revokeSigner` only flip status and emit
 * audit/host events. Real cosign verification is deferred to stage 2+.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { PluginSigner, Plugin, AuditEntry } from '@/api/resources/types';
import type { CreateSignerInput, UpdateSignerInput } from './types';
import { SignerInUseError } from './types';

const nextSignerId = makeIdFactory('signer-new');
const nextAuditId = makeIdFactory('audit-signer');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function currentActor(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAuditEntry(
  tenantId: string | null,
  action: string,
  resourceId: string,
  tier: AuditEntry['tier'] = 'write',
  diff?: { before: unknown; after: unknown },
): AuditEntry {
  const entry: AuditEntry = {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: currentActor(),
    action,
    resource_type: 'plugin-signer',
    resource_id: resourceId,
    outcome: 'success',
    at: now(),
    tier,
  };
  if (diff) entry.diff = diff;
  return entry;
}

/** Returns the plugin ids that reference a given signer (used by delete guard). */
function pluginsReferencing(signerId: string, plugins: Record<string, Plugin>): string[] {
  const ids: string[] = [];
  for (const p of Object.values(plugins)) {
    if (p.signer_id === signerId) ids.push(p.id);
  }
  return ids;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Returns signers visible under a scope.
 *   - tenantId === null → returns only global signers (tenant_scope === null).
 *   - tenantId is a tenant id → returns signers for that tenant only (does NOT
 *     mix in globals, so the tenant-scoped UI doesn't show cross-tenant or
 *     global entries; a super-admin view uses tenantId=null).
 */
export function useSignerList(tenantId: string | null): PluginSigner[] {
  const signers = useMockStore((s) => s.pluginSigners);
  const results: PluginSigner[] = [];
  for (const s of Object.values(signers)) {
    if (s.tenant_scope !== tenantId) continue;
    results.push(s);
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function useSignerDetail(id: string): PluginSigner | undefined {
  return useMockStore((s) => s.pluginSigners[id]);
}

/** Plugins signed by a given signer — stable sort by display name. */
export function useSignerPlugins(id: string): Plugin[] {
  const plugins = useMockStore((s) => s.plugins);
  const out: Plugin[] = [];
  for (const p of Object.values(plugins)) {
    if (p.signer_id === id) out.push(p);
  }
  return out.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createSigner(input: CreateSignerInput): Promise<PluginSigner> {
  await simulateLatency('mutation');

  const id = nextSignerId();
  const signer: PluginSigner = {
    id,
    tenant_scope: input.tenant_scope,
    name: input.name,
    fingerprint: input.fingerprint.toLowerCase(),
    status: input.status ?? 'pending',
    ...(input.description !== undefined ? { description: input.description } : {}),
    created_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('pluginSigners', signer);
  state.appendAudit(makeAuditEntry(input.tenant_scope, 'plugin-signer.create', id));
  emitHostEvent('plugin-signer.created', {
    signer_id: id,
    tenant_id: input.tenant_scope,
  });
  return signer;
}

export async function updateSigner(id: string, input: UpdateSignerInput): Promise<PluginSigner> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.pluginSigners[id];
  if (!current) throw new Error(`Signer ${id} not found`);

  const patch: Partial<PluginSigner> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.fingerprint !== undefined) patch.fingerprint = input.fingerprint.toLowerCase();

  const before = { ...current };
  state.updateEntity('pluginSigners', id, patch);
  const updated = useMockStore.getState().pluginSigners[id];
  if (!updated) throw new Error(`Signer ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(current.tenant_scope, 'plugin-signer.update', id),
    diff: { before, after: updated },
  });
  emitHostEvent('plugin-signer.updated', {
    signer_id: id,
    tenant_id: current.tenant_scope,
  });
  return updated;
}

export async function deleteSigner(id: string): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const signer = state.pluginSigners[id];
  if (!signer) throw new Error(`Signer ${id} not found`);

  const referencing = pluginsReferencing(id, state.plugins);
  if (referencing.length > 0) {
    throw new SignerInUseError(referencing);
  }

  state.deleteEntity('pluginSigners', id);
  state.appendAudit(makeAuditEntry(signer.tenant_scope, 'plugin-signer.delete', id, 'destructive'));
  emitHostEvent('plugin-signer.deleted', {
    signer_id: id,
    tenant_id: signer.tenant_scope,
  });
}

/**
 * Mark a signer as verified (mock cosign verification).
 *
 * Idempotent: if status is already 'verified', no mutation is performed and
 * no audit/event is emitted.
 */
export async function verifySigner(id: string): Promise<PluginSigner> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.pluginSigners[id];
  if (!current) throw new Error(`Signer ${id} not found`);
  if (current.status === 'verified') return current;

  const before = { status: current.status };
  state.updateEntity('pluginSigners', id, { status: 'verified' });
  const updated = useMockStore.getState().pluginSigners[id];
  if (!updated) throw new Error(`Signer ${id} vanished mid-verify`);

  state.appendAudit({
    ...makeAuditEntry(current.tenant_scope, 'plugin-signer.verify', id),
    diff: { before, after: { status: 'verified' } },
  });
  emitHostEvent('plugin-signer.verified', {
    signer_id: id,
    tenant_id: current.tenant_scope,
  });
  return updated;
}

/**
 * Mark a signer as revoked. Existing plugins signed by this signer keep
 * their signer_id (historical fidelity) but lose trust — the UI surfaces
 * the revoked state on the plugin detail.
 */
export async function revokeSigner(id: string): Promise<PluginSigner> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.pluginSigners[id];
  if (!current) throw new Error(`Signer ${id} not found`);
  if (current.status === 'revoked') return current;

  const before = { status: current.status };
  state.updateEntity('pluginSigners', id, { status: 'revoked' });
  const updated = useMockStore.getState().pluginSigners[id];
  if (!updated) throw new Error(`Signer ${id} vanished mid-revoke`);

  state.appendAudit({
    ...makeAuditEntry(current.tenant_scope, 'plugin-signer.revoke', id, 'destructive'),
    diff: { before, after: { status: 'revoked' } },
  });
  emitHostEvent('plugin-signer.revoked', {
    signer_id: id,
    tenant_id: current.tenant_scope,
  });
  return updated;
}
