/**
 * nav-bootstrap — imports each feature's nav.ts for its side-effects so that
 * all nav entries are registered before the first render.
 *
 * Import this module once, early in the app entry point.
 * The order of imports is alphabetical by feature name.
 */

// apim group
import '@/features/api-explorer/nav';
import '@/features/middlewares/nav';
import '@/features/policies/nav';
import '@/features/routes/nav';
import '@/features/services/nav';

// ai group
import '@/features/ai-agents/nav';
import '@/features/ai-mcp-servers/nav';
import '@/features/ai-providers/nav';
import '@/features/ai-rate-limits/nav';
import '@/features/ai-tool-routing/nav';
import '@/features/ai-tools/nav';
import '@/features/ai-traces/nav';

// security group (also registers the ai-group access-policies entry)
import '@/features/security/nav';

// system group
import '@/features/cluster/nav';
import '@/features/notifications/nav';
import '@/features/plugins/nav';
