import { useMemo } from 'react';
import {
  createSite as orvalCreateSite,
  patchSite as orvalPatchSite,
  deleteSite as orvalDeleteSite,
  toggleSite as orvalToggleSite,
} from '@/api/generated/sites/sites';
import type { Site as ProtoSite } from '@/api/generated/schemas';
import type { Service, Site } from '@/api/resources';
import { fromProtoSite, toProtoSiteCreate, toProtoSitePatch } from './adapter';
import { useSiteListReal, useSiteDetailReal } from './api.stage2';
import type { SiteFilter, SiteUpdateInput, SiteWizardInput } from './types';

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useSiteList(tenantId: string, filter: SiteFilter): Site[] {
  const { sites } = useSiteListReal(tenantId, filter);
  return useMemo(() => sites, [sites]);
}

/**
 * Resolves the tenant slug from the URL so single-arg call sites keep
 * working in path-prefix tenancy mode.
 */
export function useSiteDetail(siteId: string): Site | undefined {
  const tenantId = readTenantFromLocation();
  return useSiteDetailReal(tenantId ?? '', siteId);
}

function readTenantFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const match = /^\/t\/([^/]+)/.exec(window.location.pathname);
  return match?.[1] ?? null;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Wizard-level create. The wizard component orchestrates upstream-service
 * creation via `useCreateServiceMutation` before calling here; in
 * `existing_service` mode the id arrives via `input.upstream_service_id`.
 * Returns `{ site }` always; `service` is never auto-created here.
 */
export async function createSite(
  tenantId: string,
  input: SiteWizardInput,
): Promise<{ site: Site; service?: Service }> {
  const upstreamId =
    input.upstream_mode === 'existing_service' ? input.upstream_service_id : undefined;
  const body = toProtoSiteCreate(input, upstreamId);
  const res = (await orvalCreateSite(tenantId, body)) as unknown as {
    data: ProtoSite;
  };
  return { site: fromProtoSite(res.data, tenantId) };
}

export async function updateSite(
  tenantId: string,
  id: string,
  input: SiteUpdateInput,
): Promise<Site> {
  const body = toProtoSitePatch(input);
  const res = (await orvalPatchSite(tenantId, id, body)) as unknown as {
    data: ProtoSite;
  };
  return fromProtoSite(res.data, tenantId);
}

export async function deleteSite(
  tenantId: string,
  id: string,
  typedDomainConfirm: string,
  expectedDomain: string,
): Promise<void> {
  // UX guardrail: domain confirmation. Daemon does not enforce this.
  if (typedDomainConfirm !== expectedDomain) {
    throw new Error(
      `Typed domain confirm "${typedDomainConfirm}" does not match site domain "${expectedDomain}"`,
    );
  }
  await orvalDeleteSite(tenantId, id);
}

export async function toggleSite(tenantId: string, id: string, enabled: boolean): Promise<void> {
  await orvalToggleSite(tenantId, id, { enabled });
}
