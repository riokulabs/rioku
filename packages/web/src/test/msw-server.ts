/**
 * MSW server setup for vitest. Uses Orval-generated handlers as the default
 * test backend. Individual tests can override per-call with `server.use(...)`.
 */
import { setupServer } from 'msw/node';

import { getAiAgentsMock } from '@/api/generated/ai-agents/ai-agents.msw';
import { getAiMcpServersMock } from '@/api/generated/ai-mcp-servers/ai-mcp-servers.msw';
import { getAiRateLimitsMock } from '@/api/generated/ai-rate-limits/ai-rate-limits.msw';
import { getAiToolBindingsMock } from '@/api/generated/ai-tool-bindings/ai-tool-bindings.msw';
import { getAiToolsMock } from '@/api/generated/ai-tools/ai-tools.msw';
import { getAiTracesMock } from '@/api/generated/ai-traces/ai-traces.msw';
import { getAigatewayServiceMock } from '@/api/generated/aigateway-service/aigateway-service.msw';
import { getApiKeysMock } from '@/api/generated/api-keys/api-keys.msw';
import { getApimanagementServiceMock } from '@/api/generated/apimanagement-service/apimanagement-service.msw';
import { getAuditMock } from '@/api/generated/audit/audit.msw';
import { getBuildServiceMock } from '@/api/generated/build-service/build-service.msw';
import { getClusterServiceMock } from '@/api/generated/cluster-service/cluster-service.msw';
import { getConfigServiceMock } from '@/api/generated/config-service/config-service.msw';
import { getHealthServiceMock } from '@/api/generated/health-service/health-service.msw';
import { getPluginServiceMock } from '@/api/generated/plugin-service/plugin-service.msw';
import { getRbacPoliciesMock } from '@/api/generated/rbac-policies/rbac-policies.msw';
import { getRoutesMock } from '@/api/generated/routes/routes.msw';
import { getServicesMock } from '@/api/generated/services/services.msw';
import { getTrafficServiceMock } from '@/api/generated/traffic-service/traffic-service.msw';
import { getWafserviceMock } from '@/api/generated/wafservice/wafservice.msw';

export const server = setupServer(
  ...getAiAgentsMock(),
  ...getAiMcpServersMock(),
  ...getAiRateLimitsMock(),
  ...getAiToolBindingsMock(),
  ...getAiToolsMock(),
  ...getAiTracesMock(),
  ...getAigatewayServiceMock(),
  ...getApiKeysMock(),
  ...getApimanagementServiceMock(),
  ...getAuditMock(),
  ...getBuildServiceMock(),
  ...getClusterServiceMock(),
  ...getConfigServiceMock(),
  ...getHealthServiceMock(),
  ...getPluginServiceMock(),
  ...getRbacPoliciesMock(),
  ...getRoutesMock(),
  ...getServicesMock(),
  ...getTrafficServiceMock(),
  ...getWafserviceMock(),
);
