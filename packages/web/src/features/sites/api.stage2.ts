/**
 * Sites API — Stage 2: backed by Orval-generated TanStack Query hooks.
 *
 * Activated when `VITE_USE_MOCKS=false`. The wizard's `new_upstream` mode is
 * resolved client-side: it first creates a service (via the services feature)
 * and then creates the site with the resulting `upstream_service_id`.
 *
 * Site delete uses domain-typed confirmation in the UI; the daemon endpoint
 * itself does not require it (the typed-domain check is a UX guardrail).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listSites,
  getSite,
  createSite as orvalCreateSite,
  patchSite,
  deleteSite as orvalDeleteSite,
  toggleSite as orvalToggleSite,
  getListSitesQueryKey,
  getGetSiteQueryKey,
} from '@/api/generated/sites/sites';
import type {
  CreateSiteBody,
  ListSites200,
  Site as ProtoSite,
  UpdateSiteBody,
} from '@/api/generated/schemas';
import type { Site } from '@/api/resources';
import type { SiteFilter, SiteUpdateInput, SiteWizardInput } from './types';
import { fromProtoSite, toProtoSiteCreate, toProtoSitePatch } from './adapter';

// ─── Query hooks ──────────────────────────────────────────────────────────────

export function useSiteListReal(
  tenantId: string,
  filter: SiteFilter,
): {
  sites: Site[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: getListSitesQueryKey(tenantId),
    queryFn: ({ signal }) => listSites(tenantId, { signal }),
    enabled: Boolean(tenantId),
  });

  const body = (data as unknown as { data: ListSites200 } | undefined)?.data;
  const all: Site[] = body?.items?.map((p) => fromProtoSite(p, tenantId)) ?? [];

  const search = filter.search.toLowerCase().trim();
  const tlsSet = new Set(filter.tls_mode);
  const enabledSet = new Set(filter.enabled);
  const linkedSet = new Set(filter.linked_service_ids);

  const sites = all.filter((site) => {
    if (tlsSet.size > 0 && !tlsSet.has(site.tls_mode)) return false;
    if (enabledSet.size > 0) {
      const key: 'enabled' | 'disabled' = site.enabled ? 'enabled' : 'disabled';
      if (!enabledSet.has(key)) return false;
    }
    if (linkedSet.size > 0) {
      if (site.upstream_service_id === undefined || !linkedSet.has(site.upstream_service_id)) {
        return false;
      }
    }
    if (search) {
      const nameMatch = site.name.toLowerCase().includes(search);
      const domainMatch = site.domain.toLowerCase().includes(search);
      if (!nameMatch && !domainMatch) return false;
    }
    return true;
  });

  return { sites, isLoading, isError, error };
}

export function useSiteDetailReal(tenantId: string, siteId: string): Site | undefined {
  const { data } = useQuery({
    queryKey: getGetSiteQueryKey(tenantId, siteId),
    queryFn: ({ signal }) => getSite(tenantId, siteId, { signal }),
    enabled: Boolean(tenantId) && Boolean(siteId),
  });
  if (!data) return undefined;
  const proto = (data as unknown as { data: ProtoSite }).data;
  return fromProtoSite(proto, tenantId);
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

/**
 * Create site mutation. Caller must resolve `upstream_service_id` for the
 * `new_upstream` flow (typically via a separate `useCreateServiceMutation`
 * call before this) — this hook only creates the site itself.
 */
export function useCreateSiteMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      input: SiteWizardInput;
      upstreamServiceId?: string;
    }): Promise<Site> => {
      const body = toProtoSiteCreate(args.input, args.upstreamServiceId);
      const res = (await orvalCreateSite(
        tenantId,
        body as CreateSiteBody,
      )) as unknown as { data: ProtoSite };
      return fromProtoSite(res.data, tenantId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListSitesQueryKey(tenantId) });
    },
  });
}

export function useUpdateSiteMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; input: SiteUpdateInput }): Promise<Site> => {
      const body = toProtoSitePatch(args.input);
      const res = (await patchSite(
        tenantId,
        args.id,
        body as UpdateSiteBody,
      )) as unknown as { data: ProtoSite };
      return fromProtoSite(res.data, tenantId);
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: getListSitesQueryKey(tenantId) });
      void qc.invalidateQueries({ queryKey: getGetSiteQueryKey(tenantId, vars.id) });
    },
  });
}

export function useDeleteSiteMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; typedDomainConfirm: string; expectedDomain: string }): Promise<void> => {
      // UX guardrail: domain confirmation. Daemon does not enforce this.
      if (args.typedDomainConfirm !== args.expectedDomain) {
        throw new Error(
          `Typed domain confirm "${args.typedDomainConfirm}" does not match site domain "${args.expectedDomain}"`,
        );
      }
      await orvalDeleteSite(tenantId, args.id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListSitesQueryKey(tenantId) });
    },
  });
}

export function useToggleSiteMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; enabled: boolean }): Promise<void> => {
      await orvalToggleSite(tenantId, args.id, { enabled: args.enabled });
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: getListSitesQueryKey(tenantId) });
      void qc.invalidateQueries({ queryKey: getGetSiteQueryKey(tenantId, vars.id) });
    },
  });
}

