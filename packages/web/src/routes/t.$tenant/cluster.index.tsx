/**
 * Cluster index — /t/$tenant/cluster
 *
 * Combined overview, single-page layout: summary
 * cards + nodes list + active enrollment tokens. The dedicated subroutes
 * (cluster.nodes.tsx, cluster.enrollment-tokens.tsx) provide focused views
 * for power users; the index keeps the at-a-glance experience.
 *
 * Permission inherited from cluster.tsx (cluster:read). Mutations gated
 * inside <ClusterPage> via usePermission().
 */
import { createFileRoute } from '@tanstack/react-router';
import { ClusterPage } from '@/features/cluster';

export const Route = createFileRoute('/t/$tenant/cluster/')({
  component: ClusterPage,
});
