/**
 * Sites API — backed by the Zustand mock store.
 *
 * Wizard-level `createSite` creates a linked Service automatically when
 * `upstream_mode === 'new_upstream'`; reuses an existing one when
 * `upstream_mode === 'existing_service'`.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type {
  AuditEntry,
  Service,
  Site,
} from '@/api/resources/types';
import type { SiteFilter, SiteUpdateInput, SiteWizardInput } from './types';

const nextSiteId = makeIdFactory('site-new');
const nextServiceId = makeIdFactory('service-site-new');
const nextAuditId = makeIdFactory('audit-site');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAuditEntry(
  actorId: string,
  tenantId: string | null,
  action: string,
  resourceId?: string,
): AuditEntry {
  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    resource_type: 'site',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier: 'write',
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useSiteList(tenantId: string, filter: SiteFilter): Site[] {
  const sites = useMockStore((s) => s.sites);
  const search = filter.search.toLowerCase().trim();

  const results: Site[] = [];
  for (const site of Object.values(sites)) {
    if (site.tenant_id !== tenantId) continue;
    if (filter.tls_mode !== 'all' && site.tls_mode !== filter.tls_mode) continue;
    if (filter.enabled === 'enabled' && !site.enabled) continue;
    if (filter.enabled === 'disabled' && site.enabled) continue;
    if (
      filter.linked_service_id !== null &&
      site.upstream_service_id !== filter.linked_service_id
    ) {
      continue;
    }
    if (search) {
      const nameMatch = site.name.toLowerCase().includes(search);
      const domainMatch = site.domain.toLowerCase().includes(search);
      if (!nameMatch && !domainMatch) continue;
    }
    results.push(site);
  }
  return results;
}

export function useSiteDetail(siteId: string): Site | undefined {
  return useMockStore((s) => s.sites[siteId]);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Wizard-level create. When `upstream_mode === 'new_upstream'`, creates and
 * links a new Service atomically with the Site. When `existing_service`,
 * reuses the referenced Service.
 *
 * Returns the created `Site` plus (when applicable) the created `Service`.
 */
export async function createSite(
  tenantId: string,
  input: SiteWizardInput,
): Promise<{ site: Site; service?: Service }> {
  await simulateLatency('mutation');

  let createdService: Service | undefined;
  let upstreamServiceId: string | undefined;

  if (input.upstream_mode === 'existing_service') {
    upstreamServiceId = input.upstream_service_id;
  } else {
    // upstream_mode === 'new_upstream' — protocol + host are required by the
    // wizard schema, but we guard here to satisfy the type narrower and to
    // surface a clean error if callers bypass the schema.
    const protocol = input.upstream_protocol;
    const host = input.upstream_host;
    if (protocol === undefined || host === undefined) {
      throw new Error(
        'createSite: new_upstream mode requires upstream_protocol and upstream_host',
      );
    }
    const serviceId = nextServiceId();
    const upstream =
      input.upstream_port !== undefined
        ? `${protocol}://${host}:${String(input.upstream_port)}`
        : `${protocol}://${host}`;
    createdService = {
      id: serviceId,
      tenant_id: tenantId,
      name: `${input.name}-upstream`,
      upstream,
      upstream_protocol: protocol,
      env: 'production',
      health: 'healthy',
      tags: ['auto-created'],
      description: `Auto-created upstream for site ${input.domain}`,
      created_at: now(),
    };
    upstreamServiceId = serviceId;
  }

  const siteId = nextSiteId();
  const site: Site = {
    id: siteId,
    tenant_id: tenantId,
    name: input.name,
    domain: input.domain,
    tls_mode: input.tls_mode,
    enabled: true,
    ...(upstreamServiceId !== undefined
      ? { upstream_service_id: upstreamServiceId }
      : {}),
    ...(input.tls_mode === 'manual' &&
    input.tls_manual_cert_pem !== undefined &&
    input.tls_manual_key_pem !== undefined
      ? {
          tls_manual_cert: {
            cert_pem_preview: input.tls_manual_cert_pem.slice(0, 64),
            key_pem_preview: input.tls_manual_key_pem.slice(0, 32),
          },
        }
      : {}),
    basic_auth_enabled: input.basic_auth_enabled ?? false,
    rate_limit_preset: input.rate_limit_preset ?? 'none',
    redirect_rules: input.redirect_rules ?? [],
    created_at: now(),
    updated_at: now(),
  };

  // Atomic: write both entities in a single store update to avoid races.
  useMockStore.setState((state) => {
    const nextServices = createdService
      ? { ...state.services, [createdService.id]: createdService }
      : state.services;
    return {
      services: nextServices,
      sites: { ...state.sites, [siteId]: site },
    };
  });

  const state = useMockStore.getState();
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), tenantId, 'site.create', siteId),
  );
  if (createdService) {
    state.appendAudit({
      ...makeAuditEntry(
        getCurrentActorId(),
        tenantId,
        'service.create',
        createdService.id,
      ),
      resource_type: 'service',
      payload: { reason: 'auto-created for site', site_id: siteId },
    });
    emitHostEvent('service.created', {
      service_id: createdService.id,
      tenant_id: tenantId,
    });
  }
  emitHostEvent('site.created', { site_id: siteId, tenant_id: tenantId });

  return createdService ? { site, service: createdService } : { site };
}

export async function updateSite(
  id: string,
  input: SiteUpdateInput,
): Promise<Site> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.sites[id];
  if (!current) throw new Error(`Site ${id} not found`);

  const patch: Partial<Site> = { updated_at: now() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.domain !== undefined) patch.domain = input.domain;
  if (input.tls_mode !== undefined) patch.tls_mode = input.tls_mode;
  if (input.upstream_service_id !== undefined) {
    patch.upstream_service_id = input.upstream_service_id;
  }
  if (input.basic_auth_enabled !== undefined)
    patch.basic_auth_enabled = input.basic_auth_enabled;
  if (input.rate_limit_preset !== undefined)
    patch.rate_limit_preset = input.rate_limit_preset;
  if (input.redirect_rules !== undefined)
    patch.redirect_rules = input.redirect_rules;

  const before = { ...current };
  state.updateEntity('sites', id, patch);
  const updated = useMockStore.getState().sites[id];
  if (!updated) throw new Error(`Site ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), current.tenant_id, 'site.update', id),
    diff: { before, after: updated },
  });
  emitHostEvent('site.updated', { site_id: id, tenant_id: current.tenant_id });
  return updated;
}

export async function deleteSite(
  id: string,
  typedDomainConfirm: string,
): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const site = state.sites[id];
  if (!site) throw new Error(`Site ${id} not found`);
  if (typedDomainConfirm !== site.domain) {
    throw new Error(
      `Typed domain confirm "${typedDomainConfirm}" does not match site domain "${site.domain}"`,
    );
  }

  state.deleteEntity('sites', id);
  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), site.tenant_id, 'site.delete', id),
    tier: 'destructive',
  });
  emitHostEvent('site.deleted', { site_id: id, tenant_id: site.tenant_id });
}

export async function toggleSite(id: string, enabled: boolean): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const site = state.sites[id];
  if (!site) throw new Error(`Site ${id} not found`);

  state.updateEntity('sites', id, { enabled, updated_at: now() });
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      site.tenant_id,
      enabled ? 'site.enable' : 'site.disable',
      id,
    ),
  );
  emitHostEvent('site.updated', {
    site_id: id,
    tenant_id: site.tenant_id,
    change: enabled ? 'enabled' : 'disabled',
  });
}
