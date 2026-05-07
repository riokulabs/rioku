/**
 * /t/$tenant/cluster/nodes — focused cluster nodes list with stat cards.
 *
 * Permission inherited from cluster.tsx (cluster:read).
 */
import { createFileRoute } from '@tanstack/react-router';
import { NodesListPage } from '@/features/cluster/components/nodes-list-page';

export const Route = createFileRoute('/t/$tenant/cluster/nodes')({
  component: NodesListPage,
});
