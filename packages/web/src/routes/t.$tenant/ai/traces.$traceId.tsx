/**
 * Single AI trace — full-page route.
 *
 * /t/$tenant/ai/traces/$traceId — deep link target reached via the
 * "Open full page" button on the trace drawer or by pasting a URL.
 *
 * Permission guard: ai-trace:read.
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { TraceFullPage } from '@/features/ai-traces';

function TraceDeepLinkPage() {
  const { tenant, traceId } = Route.useParams();
  return <TraceFullPage tenantSlug={tenant} traceId={traceId} />;
}

export const Route = createFileRoute('/t/$tenant/ai/traces/$traceId')({
  beforeLoad: requirePermissions({ required: ['ai-trace:read'] }),
  component: TraceDeepLinkPage,
});
