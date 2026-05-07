/**
 * RBAC policy full-page route — /t/$tenant/security/rbac-policies/$policyId
 *
 * Renders <RbacPolicyFullPage> with Tabs (Overview / Bound subjects / Audit).
 * Permission guard requires `policy:read`.
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { RbacPolicyFullPage } from '@/features/security/rbac-policies';

function RbacPolicyDetailRoute() {
  const { tenant, policyId } = Route.useParams();
  return <RbacPolicyFullPage tenant={tenant} policyId={policyId} />;
}

export const Route = createFileRoute('/t/$tenant/security/rbac-policies/$policyId')({
  beforeLoad: requirePermissions({ required: ['policy:read'] }),
  component: RbacPolicyDetailRoute,
});
