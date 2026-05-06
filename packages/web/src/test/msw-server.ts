/**
 * MSW server setup for vitest. Uses Orval-generated handlers as the default
 * test backend. Individual tests can override per-call with `server.use(...)`.
 */
import { setupServer } from 'msw/node';

import { getAccessPoliciesMock } from '@/api/generated/access-policies/access-policies.msw';
import { getAigatewayServiceMock } from '@/api/generated/aigateway-service/aigateway-service.msw';
import { getApiKeysMock } from '@/api/generated/api-keys/api-keys.msw';
import { getApimanagementServiceMock } from '@/api/generated/apimanagement-service/apimanagement-service.msw';
import { getAuditMock } from '@/api/generated/audit/audit.msw';
import { getBuildServiceMock } from '@/api/generated/build-service/build-service.msw';
import { getClusterServiceMock } from '@/api/generated/cluster-service/cluster-service.msw';
import { getConfigServiceMock } from '@/api/generated/config-service/config-service.msw';
import { getHealthServiceMock } from '@/api/generated/health-service/health-service.msw';
import { getImpersonationMock } from '@/api/generated/impersonation/impersonation.msw';
import { getPermissionsMock } from '@/api/generated/permissions/permissions.msw';
import { getPluginServiceMock } from '@/api/generated/plugin-service/plugin-service.msw';
import { getRbacPoliciesMock } from '@/api/generated/rbac-policies/rbac-policies.msw';
import { getRolesMock } from '@/api/generated/roles/roles.msw';
import { getRoutesMock } from '@/api/generated/routes/routes.msw';
import { getServicesMock } from '@/api/generated/services/services.msw';
import { getSessionsMock } from '@/api/generated/sessions/sessions.msw';
import { getTrafficServiceMock } from '@/api/generated/traffic-service/traffic-service.msw';
import { getUsersMock } from '@/api/generated/users/users.msw';
import { getWafserviceMock } from '@/api/generated/wafservice/wafservice.msw';

export const server = setupServer(
  ...getAccessPoliciesMock(),
  ...getAigatewayServiceMock(),
  ...getApiKeysMock(),
  ...getApimanagementServiceMock(),
  ...getAuditMock(),
  ...getBuildServiceMock(),
  ...getClusterServiceMock(),
  ...getConfigServiceMock(),
  ...getHealthServiceMock(),
  ...getImpersonationMock(),
  ...getPermissionsMock(),
  ...getPluginServiceMock(),
  ...getRbacPoliciesMock(),
  ...getRolesMock(),
  ...getRoutesMock(),
  ...getServicesMock(),
  ...getSessionsMock(),
  ...getTrafficServiceMock(),
  ...getUsersMock(),
  ...getWafserviceMock(),
);
