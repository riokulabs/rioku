/**
 * Full-page view for a single AI MCP server —
 * /t/$tenant/ai/mcp-servers/$serverId
 *
 * Renders the {@link McpServerFullPage} component with Tabs:
 *   Configuration / Test connectivity / Tools / Audit.
 *
 * Permission: mcp-server:read (write actions are gated inside the page).
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { McpServerFullPage } from '@/features/ai-mcp-servers';

function McpServerDetailRoute() {
  const { tenant, serverId } = Route.useParams();
  return <McpServerFullPage tenant={tenant} serverId={serverId} />;
}

export const Route = createFileRoute('/t/$tenant/ai/mcp-servers/$serverId')({
  beforeLoad: requirePermissions({ required: ['mcp-server:read'] }),
  component: McpServerDetailRoute,
});
