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
 * Plus one new helper: `usePoliciesAttachedToRoute(routeId)` which reads
 * `state.routes[routeId].policies` and resolves the AccessPolicy records.
 */
import { useMockStore } from '@/api/mock-store';
import type { AccessPolicy } from '@/api/resources';

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
 * Returns the AccessPolicy records attached to a route.
 * Selectors pull raw records; the resolve-to-array happens in the hook body
 * so the returned reference is stable between re-renders unless the route's
 * `policies` array or the underlying AccessPolicy map changes.
 */
export function usePoliciesAttachedToRoute(routeId: string): AccessPolicy[] {
  const routes = useMockStore((s) => s.routes);
  const policies = useMockStore((s) => s.accessPolicies);
  const route = routes[routeId];
  if (!route) return [];

  const attached: AccessPolicy[] = [];
  for (const id of route.policies) {
    const policy = policies[id];
    if (policy) attached.push(policy);
  }
  return attached;
}
