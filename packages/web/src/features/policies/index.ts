/**
 * Policies feature — thin re-export barrel.
 *
 * Per spec §7.4 ("one engine, two UIs"), Access Policies and per-route
 * Policies share the same underlying AccessPolicy resource. The only
 * distinction is navigation context (tenant-wide list vs service-scoped
 * attach-picker).
 *
 * This barrel aliases the access-policies feature exports to shorter
 * "Policy"-prefixed names that the API-management UI can adopt without
 * duplicating the resource layer.
 *
 * Plus one helper: `usePoliciesAttachedToRoute(tenantId, routeId)` which
 * fetches the route via the real daemon endpoint and resolves its
 * `policies` array against the access-policy list.
 */
import { useMemo } from 'react';
import type { AccessPolicy } from '@/api/resources';
import { useAccessPolicyList } from '@/features/security/access-policies';
import { useRouteDetailReal } from '@/features/routes/api.stage2';

export {
  useAccessPolicyList as usePolicyList,
  useAccessPolicy as usePolicyDetail,
  createAccessPolicyMutation as createPolicy,
  updateAccessPolicyMutation as updatePolicy,
  deleteAccessPolicyMutation as deletePolicy,
} from '@/features/security/access-policies';

export type { AccessPolicy as Policy } from '@/api/resources';
export type { AccessPolicyPayload as PolicyPayload } from '@/features/security/access-policies';

/**
 * Returns the AccessPolicy records attached to a route. Resolves
 * route → policy IDs → AccessPolicy records via the tenant-scoped real
 * endpoints. Filters out unresolved IDs.
 */
export function usePoliciesAttachedToRoute(
  tenantId: string,
  routeId: string,
): AccessPolicy[] {
  const route = useRouteDetailReal(tenantId, routeId);
  const { data: allPolicies } = useAccessPolicyList(tenantId);

  return useMemo(() => {
    if (!route) return [];
    const byId = new Map<string, AccessPolicy>();
    for (const p of allPolicies) byId.set(p.id, p);
    const attached: AccessPolicy[] = [];
    for (const id of route.policies) {
      const p = byId.get(id);
      if (p) attached.push(p);
    }
    return attached;
  }, [route, allPolicies]);
}
