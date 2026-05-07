/**
 * Per-site detail page — /t/$tenant/sites/$siteId
 *
 * The trailing underscore on `sites_` is the TanStack Router flat-route
 * convention — it lets us declare a sibling detail URL without turning the
 * sites list page into a layout with <Outlet>. The URL emitted is still
 * `/t/$tenant/sites/$siteId`.
 *
 * Renders the tabbed full-page view (Overview / TLS / Routes / Audit). All
 * Mantine UI; site data is loaded via the real Orval-generated GET endpoint.
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { SiteFullPage } from '@/features/sites';

function SiteDetailPage() {
  const { tenant, siteId } = Route.useParams();
  const tenantId = tenant;
  const tenantSlug = tenant;

  return <SiteFullPage tenantId={tenantId} tenantSlug={tenantSlug} siteId={siteId} />;
}

export const Route = createFileRoute('/t/$tenant/sites_/$siteId')({
  beforeLoad: requirePermissions({ required: ['site:read'] }),
  component: SiteDetailPage,
});
