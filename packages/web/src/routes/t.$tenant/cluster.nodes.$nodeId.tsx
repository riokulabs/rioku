/**
 * /t/$tenant/cluster/nodes/$nodeId — full-page detail for a single node.
 *
 * Permission inherited from cluster.tsx (cluster:read). Remove action gated
 * client-side by cluster:write; daemon enforces cluster:manage.
 */
import { createFileRoute } from '@tanstack/react-router';
import { NodeDetailPage } from '@/features/cluster/components/node-detail-page';

export const Route = createFileRoute('/t/$tenant/cluster/nodes/$nodeId')({
  component: NodeDetailPage,
});
