/**
 * Role full-page route — /t/$tenant/security/roles/$roleId
 *
 * Renders <RoleFullPage> with Tabs (Overview / Members / Effective
 * Permissions). Permission guard requires `role:read`.
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { RoleFullPage } from '@/features/security/roles';

function RoleDetailRoute() {
  const { tenant, roleId } = Route.useParams();
  return <RoleFullPage tenant={tenant} roleId={roleId} />;
}

export const Route = createFileRoute('/t/$tenant/security/roles/$roleId')({
  beforeLoad: requirePermissions({ required: ['role:read'] }),
  component: RoleDetailRoute,
});
