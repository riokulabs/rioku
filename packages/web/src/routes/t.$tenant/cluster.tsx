/**
 * Cluster section layout — /t/$tenant/cluster
 *
 * Pure outlet container. Children render focused subpages:
 *   - /t/$tenant/cluster              (index — combined overview, see cluster.index.tsx)
 *   - /t/$tenant/cluster/nodes        (nodes-only list page)
 *   - /t/$tenant/cluster/nodes/$id    (single-node detail page)
 *   - /t/$tenant/cluster/enrollment-tokens (tokens management)
 *
 * Permission guard: cluster:read. Stricter guards applied per-child for
 * write/manage actions (cluster:write, cluster:enroll, cluster:manage).
 */
import { Outlet, createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';

export const Route = createFileRoute('/t/$tenant/cluster')({
  beforeLoad: requirePermissions({ required: ['cluster:read'] }),
  component: () => <Outlet />,
});
