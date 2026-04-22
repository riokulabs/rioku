/**
 * /admin/cluster — cluster topology view for super-admin.
 *
 * Reuses <ClusterPage> from the tenant cluster feature. At stage 2 this may
 * diverge (super-admin cross-cluster vs tenant-scoped view), but for stage 1
 * the mock-backed component is identical.
 *
 * spec §8.1 / Task 1d.78
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { ClusterPage } from '@/features/cluster';

export const Route = createFileRoute('/admin/cluster')({
  beforeLoad: requirePermissions({ required: ['admin:cross-tenant-read'] }),
  component: ClusterPage,
});
