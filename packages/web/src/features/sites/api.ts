/**
 * Sites API — Stage 2 thin facade over the Orval-generated client and the
 * stage-2 hook layer in `api.stage2.ts`.
 *
 * Stage-1 published the imperative `createSite / updateSite / deleteSite /
 * toggleSite` helpers and the `useSiteList / useSiteDetail` hooks, all
 * mock-store backed. The real-API wave landed parallel `*Real` hooks and
 * `use*Mutation` hooks in `api.stage2.ts`. This module collapses the two:
 * the legacy entry points keep their signatures (so call sites don't churn),
 * but their implementations now go through the daemon endpoints.
 *
 * Imperative mutators (`updateSite`, `deleteSite`, `toggleSite`) gain a
 * leading `tenantId` argument because the real endpoints are tenant-scoped.
 * Their three callers in `components/` are updated in the same change.
 */

import { useMemo } from 'react';
import {
  createSite as orvalCreateSite,
  patchSite as orvalPatchSite,
  deleteSite as orvalDeleteSite,
  toggleSite as orvalToggleSite,
} from '@/api/generated/sites/sites';
import type { CreateSiteBody, Site as ProtoSite, UpdateSiteBody } from '@/api/generated/schemas';
import type { Service, Site } from '@/api/resources';
import { fromProtoSite, toProtoSiteCreate, toProtoSitePatch } from './adapter';
import { useSiteListReal, useSiteDetailReal } from './api.stage2';
import type { SiteFilter, SiteUpdateInput, SiteWizardInput } from './types';

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Stage-1 hook signature, now backed by the real daemon endpoint. */
export function useSiteList(tenantId: string, filter: SiteFilter): Site[] {
  const { sites } = useSiteListReal(tenantId, filter);
  return useMemo(() => sites, [sites]);
}

/**
 * Stage-1 hook signature. The real endpoint requires a tenant; consumers
 * that don't have one in scope (legacy fixtures) will see `undefined`.
 *
 * The runtime-resolved tenant slug is read from the URL via
 * {@link useActiveTenantSlug} so existing single-arg call sites keep
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
 * Wizard-level create. Honours the wizard's `new_upstream` mode by leaving
 * the upstream-service creation to the caller (the wizard component already
 * orchestrates this via `useCreateServiceMutation` before calling here in
 * stage-2). The `upstream_service_id` arrives via `input.upstream_service_id`
 * in `existing_service` mode.
 *
 * Returns `{ site }` always; `service` is no longer auto-created here. The
 * wizard component handles the two-step create flow when needed.
 */
export async function createSite(
  tenantId: string,
  input: SiteWizardInput,
): Promise<{ site: Site; service?: Service }> {
  const upstreamId =
    input.upstream_mode === 'existing_service' ? input.upstream_service_id : undefined;
  const body = toProtoSiteCreate(input, upstreamId);
  const res = (await orvalCreateSite(tenantId, body as CreateSiteBody)) as unknown as {
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
  const res = (await orvalPatchSite(tenantId, id, body as UpdateSiteBody)) as unknown as {
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

export async function toggleSite(
  tenantId: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  await orvalToggleSite(tenantId, id, { enabled });
}
