/**
 * Access policy full-page route — /t/$tenant/security/access-policies/$policyId
 *
 * Renders <AccessPolicyFullPage> with Tabs (Overview / Test CEL / Audit).
 * Permission guard requires `policy:read`.
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { AccessPolicyFullPage } from '@/features/security/access-policies';

function AccessPolicyDetailRoute() {
  const { tenant, policyId } = Route.useParams();
  return <AccessPolicyFullPage tenantSlug={tenant} policyId={policyId} />;
}

export const Route = createFileRoute('/t/$tenant/security/access-policies/$policyId')({
  beforeLoad: requirePermissions({ required: ['policy:read'] }),
  component: AccessPolicyDetailRoute,
});
