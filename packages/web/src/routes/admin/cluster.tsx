/**
 * /admin/cluster — cluster topology placeholder.
 *
 * spec §8.1 / Task 1d.78
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { ClusterPlaceholder } from '@/features/super-admin';

export const Route = createFileRoute('/admin/cluster')({
  beforeLoad: requirePermissions({ required: ['admin:cross-tenant-read'] }),
  component: ClusterPlaceholder,
});
