/**
 * Audit page — /t/$tenant/security/audit
 *
 * Permission guard: requires audit:read.
 * Mounts <AuditList> which handles its own detail drawer internally.
 */
import { createFileRoute } from '@tanstack/react-router';
import { AuditList } from '@/features/security/audit';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';

function AuditPage() {
  const { tenant } = Route.useParams();
  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';

  return <AuditList tenantId={tenantId} />;
}

export const Route = createFileRoute('/t/$tenant/security/audit')({
  beforeLoad: requirePermissions({ required: ['audit:read'] }),
  component: AuditPage,
});
