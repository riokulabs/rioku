/**
 * /admin/audit — super-admin cross-tenant audit log.
 *
 * spec §8.1 / Task 1d.78
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { AdminAuditView } from '@/features/super-admin';

export const Route = createFileRoute('/admin/audit')({
  beforeLoad: requirePermissions({ required: ['admin:cross-tenant-read'] }),
  component: AdminAuditView,
});
