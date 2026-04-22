/**
 * Cluster management page — /t/$tenant/cluster
 *
 * Provides visibility into cluster nodes, their health metrics, and tooling
 * to enroll new members via enrollment tokens.
 *
 * Permission guard: requires cluster:read.
 * Write actions (Remove node, Revoke token, Generate token) are gated inside
 * <ClusterPage> via usePermission('cluster:write') and usePermission('cluster:enroll').
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { ClusterPage } from '@/features/cluster';

export const Route = createFileRoute('/t/$tenant/cluster')({
  beforeLoad: requirePermissions({ required: ['cluster:read'] }),
  component: ClusterPage,
});
