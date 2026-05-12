/**
 * /admin/audit — super-admin cross-tenant audit log.
 *
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { AdminAuditView } from '@/features/super-admin';

export const Route = createFileRoute('/admin/audit')({
  beforeLoad: requirePermissions({ required: ['admin:cross-tenant-read'] }),
  component: AdminAuditView,
});
