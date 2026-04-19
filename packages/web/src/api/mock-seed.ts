/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/**
 * Seed the Zustand mock store with deterministic fixtures per spec §13.2.
 *
 * Target counts:
 *   3 tenants, 15 users, 8 roles, 20 services, 60 routes, 15 access policies,
 *   6 rbac policies, 10 middlewares, 8 sites, 25 api keys, 30 sessions,
 *   300 audit entries, 5 dashboards, 4–8 widgets each, 4 installed plugins,
 *   20 marketplace listings, 40 inbox notifications, 6 notification channels,
 *   8 routing rules, 100 delivery log entries, 4 AI providers, 6 AI agents,
 *   12 AI tools, 200 AI traces, 3 MCP servers.
 *
 * Call seedStore(useMockStore) once when the store is empty.
 */
import { makeIdFactory } from '../lib/id-generator';
import {
  BUILT_IN_PERMISSIONS,
  registerPermission,
} from '../host/permissions';
import type { StoreApi } from 'zustand';
import type * as T from './resources/types';
import type { MockStore } from './mock-store';

// ─── ID factories ─────────────────────────────────────────────────────────────

const nextUserId = makeIdFactory('user');
const nextTenantId = makeIdFactory('tenant');
const nextMembershipId = makeIdFactory('membership');
const nextRoleId = makeIdFactory('role');
const nextServiceId = makeIdFactory('service');
const nextRouteId = makeIdFactory('route');
const nextMiddlewareId = makeIdFactory('middleware');
const nextApiKeyId = makeIdFactory('apikey');
const nextSessionId = makeIdFactory('session');
const nextAuditId = makeIdFactory('audit');
const nextSiteId = makeIdFactory('site');
const nextDashboardId = makeIdFactory('dashboard');
const nextWidgetId = makeIdFactory('widget');
const nextNotifId = makeIdFactory('notif');
const nextChannelId = makeIdFactory('channel');
const nextRuleId = makeIdFactory('rule');
const nextDeliveryId = makeIdFactory('delivery');
const nextPluginId = makeIdFactory('plugin');
const nextMarketId = makeIdFactory('market');
const nextProvId = makeIdFactory('aiprov');
const nextAgentId = makeIdFactory('agent');
const nextToolId = makeIdFactory('tool');
const nextTraceId = makeIdFactory('trace');
const nextMcpId = makeIdFactory('mcp');
const nextAccessPolicyId = makeIdFactory('acpol');
const nextRbacPolicyId = makeIdFactory('rbacpol');
const nextImpersonationId = makeIdFactory('imp');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns an ISO timestamp offset by `daysAgo` days from now */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function hoursAgo(n: number): string {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

/** Simple pick from array without randomness — index-based for determinism */
function pick<T>(arr: T[], index: number): T {
   
  return arr[index % arr.length]!;
}

// ─── Main seed function ───────────────────────────────────────────────────────

export function seedStore(store: StoreApi<MockStore>): void {
  // Use bound closures to avoid unbound-method lint errors when destructuring
  // Zustand store actions (which use `this` internally via Zustand's set/get).
  const addEntity: MockStore['addEntity'] = (...args) => {
    store.getState().addEntity(...args);
  };
  const appendAudit = (entry: Parameters<MockStore['appendAudit']>[0]) => {
    store.getState().appendAudit(entry);
  };

  // ── Permissions — seed built-ins + sample plugin permission ─────────────
  // `permissions` is keyed by Permission.key (not .id), so we populate it
  // via store.setState rather than addEntity (which indexes by .id).

  const permMap: Record<string, T.Permission> = {};
  for (const p of BUILT_IN_PERMISSIONS) {
    permMap[p.key] = p;
  }

  // Demo plugin permission — illustrates the plugin-manifest source.
  const pluginPerm: T.Permission = {
    key: 'com.acme.billing:invoice:read',
    description: 'Read billing invoices (Acme Billing plugin)',
    source: 'plugin-manifest',
  };
  permMap[pluginPerm.key] = pluginPerm;
  // Register into the host catalog so UI tools (registerPermission guard) see it.
  registerPermission(pluginPerm);

  store.setState({ permissions: permMap });

  // ── Tenants ──────────────────────────────────────────────────────────────

  const acmeTenantId = nextTenantId();
  const betaTenantId = nextTenantId();
  const gammaTenantId = nextTenantId();

  const tenants: T.Tenant[] = [
    {
      id: acmeTenantId,
      slug: 'acme',
      name: 'Acme Corp',
      accent: '#22c55e',
      plan: 'enterprise',
      created_at: daysAgo(90),
    },
    {
      id: betaTenantId,
      slug: 'beta',
      name: 'Beta Inc',
      accent: '#3b82f6',
      plan: 'pro',
      created_at: daysAgo(60),
    },
    {
      id: gammaTenantId,
      slug: 'gamma',
      name: 'Gamma Systems',
      accent: '#f59e0b',
      plan: 'community',
      created_at: daysAgo(30),
    },
  ];
  for (const t of tenants) addEntity('tenants', t);

  const allTenantIds = [acmeTenantId, betaTenantId, gammaTenantId];

  // ── Users ─────────────────────────────────────────────────────────────────

  const derrickId = nextUserId();

  interface UserSeed { email: string; name: string; disabled: boolean }
  const userSeeds: UserSeed[] = [
    { email: 'derrick@rioku.dev', name: 'Derrick M.', disabled: false },
    { email: 'alice@acme.com', name: 'Alice Chen', disabled: false },
    { email: 'bob@acme.com', name: 'Bob Nakamura', disabled: false },
    { email: 'carol@acme.com', name: 'Carol Osei', disabled: false },
    { email: 'dave@acme.com', name: 'Dave Patel', disabled: false },
    { email: 'eve@beta.io', name: 'Eve Rossi', disabled: false },
    { email: 'frank@beta.io', name: 'Frank Liu', disabled: false },
    { email: 'grace@beta.io', name: 'Grace Kim', disabled: false },
    { email: 'hank@gamma.dev', name: 'Hank Torres', disabled: false },
    { email: 'iris@gamma.dev', name: 'Iris Müller', disabled: false },
    { email: 'jack@gamma.dev', name: 'Jack Brennan', disabled: false },
    { email: 'kate@acme.com', name: 'Kate Okonkwo', disabled: true },
    { email: 'lena@beta.io', name: 'Lena Svensson', disabled: false },
    { email: 'mike@gamma.dev', name: 'Mike Popov', disabled: false },
    { email: 'nina@acme.com', name: 'Nina Andrade', disabled: false },
  ];

  const userIds: T.ID[] = [derrickId];
  for (let i = 1; i < userSeeds.length; i++) {
    userIds.push(nextUserId());
  }

  for (let i = 0; i < userSeeds.length; i++) {
     
    const seed = userSeeds[i]!;
     
    const id = userIds[i]!;
    const user: T.User = {
      id,
      email: seed.email,
      name: seed.name,
      disabled: seed.disabled,
      totp_enabled: i % 3 === 0,
      created_at: daysAgo(90 - i * 4),
      updated_at: daysAgo(i),
    };
    addEntity('users', user);
  }

  // ── Roles (8) ─────────────────────────────────────────────────────────────

  const roleNames = [
    'viewer',
    'ops',
    'billing-viewer',
    'admin',
    'contractor',
    'editor',
    'developer',
    'com.acme.billing:invoice-admin',
  ] as const;

  // Wide-permission grants for the admin role (index 3) so requirePermissions guards pass.
  const adminGrants: T.Grant[] = [
    { permission: 'user:read' },
    { permission: 'user:invite' },
    { permission: 'user:disable' },
    { permission: 'role:read' },
    { permission: 'role:write' },
    { permission: 'role:delete' },
    { permission: 'service:read' },
    { permission: 'service:write' },
    { permission: 'route:read' },
    { permission: 'route:write' },
    { permission: 'policy:read' },
    { permission: 'policy:write' },
    { permission: 'api-key:read' },
    { permission: 'api-key:create' },
    { permission: 'session:read' },
    { permission: 'session:revoke' },
    { permission: 'audit:read' },
    { permission: 'tenant:switch' },
  ];

  const viewerGrants: T.Grant[] = [
    { permission: 'user:read' },
    { permission: 'role:read' },
    { permission: 'service:read' },
    { permission: 'route:read' },
    { permission: 'policy:read' },
    { permission: 'api-key:read' },
    { permission: 'session:read' },
    { permission: 'tenant:switch' },
  ];

  const roleIds: T.ID[] = [];
  for (let i = 0; i < roleNames.length; i++) {
    const id = nextRoleId();
    roleIds.push(id);
    const roleName = roleNames[i]!;
    const role: T.Role = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: roleName,
      parent_ids: i > 0 ? [roleIds[0]!] : [],
      grants: i === 3
        ? adminGrants
        : i === 0
          ? viewerGrants
          : [{ permission: `rioku.${roleName}.read` }],
      denies: [],
      system: i < 4,
    };
    addEntity('roles', role);
  }

  const [viewerRoleId, , , adminRoleId] = roleIds as [T.ID, T.ID, T.ID, T.ID, ...T.ID[]];

  // ── Memberships — wire users to tenants ───────────────────────────────────

  const membershipData: { userId: T.ID; tenantId: T.ID; roleId: T.ID }[] = [
    { userId: derrickId, tenantId: acmeTenantId, roleId: adminRoleId },
    { userId: userIds[1]!, tenantId: acmeTenantId, roleId: viewerRoleId },
    { userId: userIds[2]!, tenantId: acmeTenantId, roleId: viewerRoleId },
    { userId: userIds[3]!, tenantId: acmeTenantId, roleId: viewerRoleId },
    { userId: userIds[4]!, tenantId: acmeTenantId, roleId: viewerRoleId },
    { userId: userIds[5]!, tenantId: betaTenantId, roleId: adminRoleId },
    { userId: userIds[6]!, tenantId: betaTenantId, roleId: viewerRoleId },
    { userId: userIds[7]!, tenantId: betaTenantId, roleId: viewerRoleId },
    { userId: userIds[8]!, tenantId: gammaTenantId, roleId: adminRoleId },
    { userId: userIds[9]!, tenantId: gammaTenantId, roleId: viewerRoleId },
    { userId: userIds[10]!, tenantId: gammaTenantId, roleId: viewerRoleId },
    { userId: userIds[11]!, tenantId: acmeTenantId, roleId: viewerRoleId },
    { userId: userIds[12]!, tenantId: betaTenantId, roleId: viewerRoleId },
    { userId: userIds[13]!, tenantId: gammaTenantId, roleId: viewerRoleId },
    { userId: userIds[14]!, tenantId: acmeTenantId, roleId: viewerRoleId },
  ];

  for (const m of membershipData) {
    const membership: T.Membership = {
      id: nextMembershipId(),
      tenant_id: m.tenantId,
      user_id: m.userId,
      role_ids: [m.roleId],
      state: 'active',
      invited_at: daysAgo(60),
      joined_at: daysAgo(59),
    };
    addEntity('memberships', membership);
  }

  // ── Services (20) ─────────────────────────────────────────────────────────

  const serviceSeeds = [
    { name: 'auth-api', upstream: 'http://auth:8080', env: 'production', health: 'healthy' as const },
    { name: 'user-api', upstream: 'http://users:8081', env: 'production', health: 'healthy' as const },
    { name: 'billing-api', upstream: 'http://billing:8082', env: 'production', health: 'degraded' as const },
    { name: 'analytics-api', upstream: 'http://analytics:8083', env: 'production', health: 'healthy' as const },
    { name: 'notification-api', upstream: 'http://notify:8084', env: 'production', health: 'healthy' as const },
    { name: 'file-storage', upstream: 'http://files:8085', env: 'production', health: 'healthy' as const },
    { name: 'search-api', upstream: 'http://search:8086', env: 'production', health: 'unhealthy' as const },
    { name: 'admin-api', upstream: 'http://admin:8087', env: 'production', health: 'healthy' as const },
    { name: 'webhook-api', upstream: 'http://webhooks:8088', env: 'production', health: 'healthy' as const },
    { name: 'graphql-gateway', upstream: 'http://gql:8089', env: 'production', health: 'healthy' as const },
    { name: 'auth-api-staging', upstream: 'http://auth-stage:9080', env: 'staging', health: 'healthy' as const },
    { name: 'user-api-staging', upstream: 'http://users-stage:9081', env: 'staging', health: 'healthy' as const },
    { name: 'billing-api-staging', upstream: 'http://billing-stage:9082', env: 'staging', health: 'healthy' as const },
    { name: 'legacy-rest', upstream: 'http://legacy:7080', env: 'production', health: 'degraded' as const },
    { name: 'mobile-bff', upstream: 'http://mobile-bff:8090', env: 'production', health: 'healthy' as const },
    { name: 'iot-ingestion', upstream: 'http://iot:8091', env: 'production', health: 'disabled' as const },
    { name: 'ml-inference', upstream: 'http://ml:8092', env: 'production', health: 'healthy' as const },
    { name: 'reporting-api', upstream: 'http://reports:8093', env: 'production', health: 'healthy' as const },
    { name: 'media-api', upstream: 'http://media:8094', env: 'production', health: 'healthy' as const },
    { name: 'partner-api', upstream: 'http://partner:8095', env: 'production', health: 'healthy' as const },
  ];

  const serviceIds: T.ID[] = [];
  for (let i = 0; i < serviceSeeds.length; i++) {
    const id = nextServiceId();
    serviceIds.push(id);
    const seed = serviceSeeds[i]!;
    const service: T.Service = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: seed.name,
      upstream: seed.upstream,
      env: seed.env,
      health: seed.health,
      created_at: daysAgo(80 - i * 3),
    };
    addEntity('services', service);
  }

  // ── Routes (60 = 3 per service) ───────────────────────────────────────────

  const methodCycle: T.Route['method'][] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  const routeIds: T.ID[] = [];

  for (let si = 0; si < serviceIds.length; si++) {
    const serviceId = serviceIds[si]!;
    for (let ri = 0; ri < 3; ri++) {
      const id = nextRouteId();
      routeIds.push(id);
      const route: T.Route = {
        id,
        service_id: serviceId,
        path: ri === 0 ? '/*' : ri === 1 ? '/v1/*' : `/v1/resource-${si + 1}/:id`,
        method: pick(methodCycle, si + ri),
        policies: [],
        middleware_ids: [],
      };
      addEntity('routes', route);
    }
  }

  // ── Middlewares (10) ──────────────────────────────────────────────────────

  const middlewareKinds: T.Middleware['kind'][] = [
    'rate-limit', 'auth', 'transform', 'cors', 'cache',
    'logging', 'custom', 'rate-limit', 'auth', 'cors',
  ];
  const middlewareIds: T.ID[] = [];

  for (let i = 0; i < 10; i++) {
    const id = nextMiddlewareId();
    middlewareIds.push(id);
    const middleware: T.Middleware = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: `${middlewareKinds[i]!}-${i + 1}`,
      kind: middlewareKinds[i]!,
      config: middlewareKinds[i] === 'rate-limit'
        ? { requests_per_second: (i + 1) * 10, burst: (i + 1) * 20 }
        : middlewareKinds[i] === 'cors'
          ? { allowed_origins: ['https://app.acme.com'], allow_credentials: true }
          : {},
      enabled: i !== 7,
    };
    addEntity('middlewares', middleware);
  }

  // ── Sites (8) ─────────────────────────────────────────────────────────────

  const siteDomains = [
    'api.acme.com', 'api-staging.acme.com', 'api.beta.io',
    'api-staging.beta.io', 'api.gamma.dev', 'admin.acme.com',
    'webhook.acme.com', 'partner.acme.com',
  ];
  const siteIds: T.ID[] = [];

  for (let i = 0; i < 8; i++) {
    const id = nextSiteId();
    siteIds.push(id);
    const site: T.Site = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: siteDomains[i]!,
      domain: siteDomains[i]!,
      tls_mode: i < 6 ? 'auto' : 'manual',
      enabled: i !== 5,
      created_at: daysAgo(70 - i * 5),
    };
    addEntity('sites', site);
  }

  // ── API Keys (25) ─────────────────────────────────────────────────────────

  const keyNames = [
    'ci-deploy', 'mobile-app', 'partner-webhook', 'monitoring',
    'staging-tests', 'analytics-reader', 'billing-sync', 'admin-scripts',
    'legacy-bridge', 'reporting', 'iot-device', 'ml-pipeline',
    'audit-exporter', 'support-tool', 'sandbox', 'perf-tests',
    'sre-alerts', 'security-scan', 'integration-test', 'data-pipeline',
    'backup-service', 'log-shipper', 'dashboard-reader', 'incident-bot', 'cron-jobs',
  ];

  for (let i = 0; i < 25; i++) {
    const id = nextApiKeyId();
    const apiKey: T.ApiKey = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: keyNames[i] ?? `api-key-${i + 1}`,
      scope: i % 3 === 0
        ? ['read', 'write']
        : i % 3 === 1
          ? ['read']
          : ['admin'],
      ...(i % 4 !== 3 ? { last_used: hoursAgo(i * 12) } : {}),
      ...(i % 5 === 0 ? { expires_at: daysFromNow(30 + i * 5) } : {}),
      revoked: i === 11,
      created_at: daysAgo(60 - i),
    };
    addEntity('apiKeys', apiKey);
  }

  // ── Access Policies (15) ──────────────────────────────────────────────────

  const policyActions: T.AccessPolicy['action'][] = ['allow', 'deny'];
  for (let i = 0; i < 15; i++) {
    const id = nextAccessPolicyId();
    const policy: T.AccessPolicy = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: `policy-${i + 1}`,
      condition: i % 2 === 0
        ? `request.method == "GET"`
        : `request.path.startsWith("/v1/admin") && !has(request.headers, "x-internal")`,
      action: pick(policyActions, i),
      priority: (i + 1) * 10,
      enabled: i % 7 !== 6,
      created_at: daysAgo(50 - i),
    };
    addEntity('accessPolicies', policy);
  }

  // ── RBAC Policies (6) ─────────────────────────────────────────────────────

  const subjectKinds: T.RbacPolicy['subject_kind'][] = ['user', 'group', 'service-account'];
  for (let i = 0; i < 6; i++) {
    const id = nextRbacPolicyId();
    const rbacPolicy: T.RbacPolicy = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: `rbac-policy-${i + 1}`,
      role_id: roleIds[i % roleIds.length]!,
      subject_kind: pick(subjectKinds, i),
      subject_id: userIds[i % userIds.length]!,
      created_at: daysAgo(45 - i * 5),
    };
    addEntity('rbacPolicies', rbacPolicy);
  }

  // ── Sessions (30) ─────────────────────────────────────────────────────────

  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/121',
    'Mozilla/5.0 (X11; Linux x86_64) Chrome/119',
    'rioku-cli/1.0.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604',
  ];

  for (let i = 0; i < 30; i++) {
    const id = nextSessionId();
    const session: T.Session = {
      id,
      user_id: userIds[i % userIds.length]!,
      tenant_id: pick(allTenantIds, i),
      ip: `10.0.${Math.floor(i / 10)}.${(i % 256) + 1}`,
      user_agent: pick(userAgents, i),
      last_seen: hoursAgo(i * 2),
      expires_at: daysFromNow(7),
      revoked: i >= 28,
    };
    addEntity('sessions', session);
  }

  // ── Audit (300) ───────────────────────────────────────────────────────────

  const auditActions = [
    'user.login', 'user.logout', 'user.invite', 'user.disable',
    'role.create', 'role.update', 'role.delete',
    'service.create', 'service.update', 'service.health_check',
    'route.create', 'route.delete',
    'api_key.create', 'api_key.revoke',
    'session.create', 'session.revoke',
    'policy.create', 'policy.update',
    'plugin.install', 'plugin.enable', 'plugin.disable',
    'tenant.update', 'site.create', 'site.update',
  ];

  const auditTiers: T.AuditEntry['tier'][] = ['read', 'read-sensitive', 'write', 'destructive'];
  const auditOutcomes: T.AuditEntry['outcome'][] = ['success', 'success', 'success', 'denied', 'error'];

  for (let i = 0; i < 300; i++) {
    const entry: T.AuditEntry = {
      id: nextAuditId(),
      tenant_id: i % 20 === 0 ? null : pick(allTenantIds, i),
      actor_id: userIds[i % userIds.length]!,
      action: auditActions[i % auditActions.length]!,
      resource_type: pick(['user', 'role', 'service', 'route', 'api_key', 'session', 'policy', 'plugin'], i),
      ...(serviceIds[i % serviceIds.length] ? { resource_id: serviceIds[i % serviceIds.length] } : {}),
      outcome: pick(auditOutcomes, i),
      at: daysAgo(Math.floor(i / 10)),
      tier: pick(auditTiers, i),
    };
    appendAudit(entry);
  }

  // ── Dashboards (5) + Widgets (4–8 each) ──────────────────────────────────

  const dashboardNames = ['Overview', 'API Health', 'Security', 'AI Usage', 'Billing'];
  const widgetKinds = ['metric', 'chart', 'table', 'status', 'heatmap', 'gauge', 'timeline', 'list'];

  for (let di = 0; di < 5; di++) {
    const dashId = nextDashboardId();
    const widgetCount = 4 + (di % 5); // 4–8 widgets
    const widgetIds: T.ID[] = [];

    for (let wi = 0; wi < widgetCount; wi++) {
      const wid = nextWidgetId();
      widgetIds.push(wid);
      const widget: T.Widget = {
        id: wid,
        dashboard_id: dashId,
        kind: pick(widgetKinds, wi + di),
        title: `${dashboardNames[di]!} — ${pick(widgetKinds, wi + di)}`,
        config: { refresh_interval: 30 + wi * 10 },
        position: {
          x: (wi % 3) * 4,
          y: Math.floor(wi / 3) * 3,
          w: 4,
          h: 3,
        },
      };
      addEntity('widgets', widget);
    }

    const dashboard: T.Dashboard = {
      id: dashId,
      tenant_id: pick(allTenantIds, di),
      name: dashboardNames[di]!,
      default: di === 0,
      widget_ids: widgetIds,
      created_at: daysAgo(70 - di * 10),
    };
    addEntity('dashboards', dashboard);
  }

  // ── Plugins (4 installed) ─────────────────────────────────────────────────

  const pluginSeeds = [
    {
      slug: 'com.acme.billing',
      display_name: 'Acme Billing',
      version: '1.3.2',
      parts: ['admin'] as T.Plugin['parts'],
      has_errors: false,
    },
    {
      slug: 'com.example.dashboards',
      display_name: 'Custom Dashboards',
      version: '0.9.1',
      parts: ['admin'] as T.Plugin['parts'],
      has_errors: false,
    },
    {
      slug: 'com.rioku.official-slack',
      display_name: 'Rioku Slack Connector',
      version: '2.0.0',
      parts: ['daemon', 'admin'] as T.Plugin['parts'],
      has_errors: false,
    },
    {
      slug: 'com.example.broken-plugin',
      display_name: 'Broken Plugin (Demo)',
      version: '0.1.0',
      parts: ['admin'] as T.Plugin['parts'],
      has_errors: true,
    },
  ];

  for (const p of pluginSeeds) {
    const plugin: T.Plugin = {
      id: nextPluginId(),
      tenant_scope: null,
      slug: p.slug,
      display_name: p.display_name,
      version: p.version,
      enabled: !p.has_errors,
      parts: p.parts,
      declared_permissions: [`${p.slug}.read`, `${p.slug}.write`],
      manifest: { slug: p.slug, version: p.version },
      has_errors: p.has_errors,
    };
    addEntity('plugins', plugin);
  }

  // ── Marketplace listings (20) ─────────────────────────────────────────────

  const marketSeeds = [
    { slug: 'com.rioku.jwt-auth', name: 'JWT Auth', author: 'Rioku Labs', verified: true, tags: ['auth', 'security'] },
    { slug: 'com.rioku.opa', name: 'OPA Policy', author: 'Rioku Labs', verified: true, tags: ['policy', 'security'] },
    { slug: 'com.community.datadog', name: 'Datadog Metrics', author: 'community', verified: false, tags: ['observability'] },
    { slug: 'com.community.sentry', name: 'Sentry Errors', author: 'community', verified: false, tags: ['observability', 'errors'] },
    { slug: 'com.rioku.slack', name: 'Slack Notify', author: 'Rioku Labs', verified: true, tags: ['notifications'] },
    { slug: 'com.community.pagerduty', name: 'PagerDuty', author: 'community', verified: false, tags: ['alerts'] },
    { slug: 'com.rioku.redis-cache', name: 'Redis Cache', author: 'Rioku Labs', verified: true, tags: ['caching', 'performance'] },
    { slug: 'com.rioku.geo-block', name: 'Geo Blocking', author: 'Rioku Labs', verified: true, tags: ['security', 'geo'] },
    { slug: 'com.community.prometheus', name: 'Prometheus', author: 'community', verified: false, tags: ['metrics'] },
    { slug: 'com.rioku.waf', name: 'Web App Firewall', author: 'Rioku Labs', verified: true, tags: ['security', 'waf'] },
    { slug: 'com.community.kibana', name: 'Kibana Bridge', author: 'community', verified: false, tags: ['logging'] },
    { slug: 'com.rioku.ai-guardrails', name: 'AI Guardrails', author: 'Rioku Labs', verified: true, tags: ['ai', 'safety'] },
    { slug: 'com.community.stripe', name: 'Stripe Webhook', author: 'community', verified: false, tags: ['payments'] },
    { slug: 'com.rioku.saml', name: 'SAML SSO', author: 'Rioku Labs', verified: true, tags: ['auth', 'sso'] },
    { slug: 'com.community.grpc-bridge', name: 'gRPC Bridge', author: 'community', verified: false, tags: ['protocol'] },
    { slug: 'com.rioku.semantic-cache', name: 'Semantic Cache', author: 'Rioku Labs', verified: true, tags: ['ai', 'caching'] },
    { slug: 'com.community.graphql', name: 'GraphQL Gateway', author: 'community', verified: false, tags: ['api', 'graphql'] },
    { slug: 'com.rioku.ip-allow-list', name: 'IP Allow List', author: 'Rioku Labs', verified: true, tags: ['security', 'network'] },
    { slug: 'com.community.vault', name: 'Vault Secrets', author: 'community', verified: false, tags: ['secrets'] },
    { slug: 'com.rioku.load-balancer', name: 'Load Balancer', author: 'Rioku Labs', verified: true, tags: ['traffic', 'performance'] },
  ];

  for (let i = 0; i < marketSeeds.length; i++) {
    const m = marketSeeds[i]!;
    const listing: T.MarketplaceListing = {
      id: nextMarketId(),
      slug: m.slug,
      display_name: m.name,
      author: m.author,
      description: `${m.name} plugin for Rioku — integrates ${m.tags.join(', ')} capabilities.`,
      version: `${Math.floor(i / 5) + 1}.${i % 5}.0`,
      tags: m.tags,
      installs: (i + 1) * 47,
      verified: m.verified,
    };
    addEntity('marketplaceListings', listing);
  }

  // ── Notification channels (6) ─────────────────────────────────────────────

  const channelKinds: T.NotificationChannel['kind'][] = ['email', 'slack', 'webhook', 'pagerduty', 'teams', 'sms'];
  const channelIds: T.ID[] = [];

  for (let i = 0; i < 6; i++) {
    const id = nextChannelId();
    channelIds.push(id);
    const channel: T.NotificationChannel = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: `${channelKinds[i]!}-channel`,
      kind: channelKinds[i]!,
      config: channelKinds[i] === 'slack'
        ? { webhook_url: 'https://hooks.slack.com/services/TXXXXXX/BXXXXXX/XXXXXXXXXXXXXXXX' }
        : channelKinds[i] === 'email'
          ? { to: 'ops@acme.com', from: 'alerts@rioku.dev' }
          : { url: `https://hooks.example.com/${i}` },
      enabled: i !== 5,
    };
    addEntity('notificationChannels', channel);
  }

  // ── Routing rules (8) ─────────────────────────────────────────────────────

  for (let i = 0; i < 8; i++) {
    const rule: T.NotificationRoutingRule = {
      id: nextRuleId(),
      tenant_id: pick(allTenantIds, i),
      name: `rule-${i + 1}`,
      event_filter: pick(['health.degraded', 'audit.destructive', 'session.revoke', 'key.expiring'], i),
      channel_ids: [channelIds[i % channelIds.length]!],
      enabled: i % 5 !== 4,
    };
    addEntity('notificationRoutingRules', rule);
  }

  // ── Inbox notifications (40) ──────────────────────────────────────────────

  const notifCategories = ['security', 'health', 'billing', 'system', 'plugin'];
  const notifTitles = [
    'API Key expiring soon',
    'Service health degraded',
    'New user invitation',
    'Policy violation detected',
    'Plugin update available',
    'Session revoked',
    'Audit alert: destructive action',
    'Billing limit approaching',
  ];

  for (let i = 0; i < 40; i++) {
    const notif: T.NotificationItem = {
      id: nextNotifId(),
      user_id: pick(userIds, i),
      category: pick(notifCategories, i),
      title: pick(notifTitles, i),
      body: `Notification body for event ${i + 1}. This is a realistic description of something that happened in your gateway.`,
      read: i > 15,
      created_at: hoursAgo(i * 3),
      ...(i % 3 === 0 ? { action_url: `/t/acme/security/api-keys` } : {}),
    };
    addEntity('notifications', notif);
  }

  // ── Delivery log (100) ────────────────────────────────────────────────────

  const deliveryStatuses: T.NotificationDeliveryLogEntry['status'][] = ['delivered', 'delivered', 'delivered', 'failed', 'pending'];

  for (let i = 0; i < 100; i++) {
    const entry: T.NotificationDeliveryLogEntry = {
      id: nextDeliveryId(),
      channel_id: channelIds[i % channelIds.length]!,
      notification_id: `notif-${String((i % 40) + 1).padStart(4, '0')}`,
      status: pick(deliveryStatuses, i),
      attempted_at: hoursAgo(i),
      ...(pick(deliveryStatuses, i) === 'failed' ? { error: 'Connection timeout' } : {}),
    };
    addEntity('notificationDeliveryLog', entry);
  }

  // ── AI Providers (4) ─────────────────────────────────────────────────────

  const providerSeeds: { name: string; kind: T.AiProvider['kind']; base_url: string }[] = [
    { name: 'OpenAI Production', kind: 'openai', base_url: 'https://api.openai.com/v1' },
    { name: 'Anthropic Claude', kind: 'anthropic', base_url: 'https://api.anthropic.com/v1' },
    { name: 'Ollama Local', kind: 'ollama', base_url: 'http://ollama:11434' },
    { name: 'Gemini Pro', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta' },
  ];

  const providerIds: T.ID[] = [];
  for (let i = 0; i < providerSeeds.length; i++) {
    const id = nextProvId();
    providerIds.push(id);
    const p = providerSeeds[i]!;
    const provider: T.AiProvider = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: p.name,
      kind: p.kind,
      base_url: p.base_url,
      enabled: i !== 2,
    };
    addEntity('aiProviders', provider);
  }

  // ── MCP Servers (3) ───────────────────────────────────────────────────────

  const mcpIds: T.ID[] = [];
  for (let i = 0; i < 3; i++) {
    const id = nextMcpId();
    mcpIds.push(id);
    const mcp: T.McpServer = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: pick(['Internal Tools MCP', 'CRM Connector MCP', 'Docs Search MCP'], i),
      url: `https://mcp-${i + 1}.internal:8443/mcp`,
      auth_kind: pick(['bearer', 'api-key', 'none'] as T.McpServer['auth_kind'][], i),
      enabled: i !== 2,
    };
    addEntity('mcpServers', mcp);
  }

  // ── AI Tools (12) ─────────────────────────────────────────────────────────

  const toolSeeds = [
    'web-search', 'code-execute', 'file-read', 'file-write',
    'db-query', 'send-email', 'create-ticket', 'get-weather',
    'calc-metrics', 'translate-text', 'summarize-doc', 'schedule-event',
  ];
  const toolIds: T.ID[] = [];

  for (let i = 0; i < 12; i++) {
    const id = nextToolId();
    toolIds.push(id);
    const tool: T.AiTool = {
      id,
      tenant_id: pick(allTenantIds, i),
      name: toolSeeds[i]!,
      description: `Tool for ${toolSeeds[i]!.replace(/-/g, ' ')} operations`,
      schema: {
        type: 'object',
        properties: { input: { type: 'string', description: 'Tool input' } },
        required: ['input'],
      },
      ...(i < 6 ? { mcp_server_id: mcpIds[i % mcpIds.length]! } : {}),
    };
    addEntity('aiTools', tool);
  }

  // ── AI Agents (6) ─────────────────────────────────────────────────────────

  const agentNames = [
    'Support Agent', 'Code Review Agent', 'Ops Assistant',
    'Security Auditor', 'Billing Advisor', 'Docs Summarizer',
  ];

  for (let i = 0; i < 6; i++) {
    const agent: T.AiAgent = {
      id: nextAgentId(),
      tenant_id: pick(allTenantIds, i),
      name: agentNames[i]!,
      provider_id: providerIds[i % providerIds.length]!,
      model: pick(['gpt-4o', 'claude-3-5-sonnet-20241022', 'gemini-1.5-pro', 'llama3.1:70b'], i),
      system_prompt: `You are a helpful ${agentNames[i]!} for Rioku API gateway.`,
      tool_ids: toolIds.slice(i * 2, i * 2 + 2),
      enabled: i !== 4,
    };
    addEntity('aiAgents', agent);
  }

  // ── AI Traces (200) ───────────────────────────────────────────────────────

  const agentIdsList = store.getState();
  const agentKeysForTrace = Object.keys(agentIdsList.aiAgents);
  const traceStatuses: T.AiTrace['status'][] = ['success', 'success', 'success', 'success', 'error', 'timeout'];

  for (let i = 0; i < 200; i++) {
    const trace: T.AiTrace = {
      id: nextTraceId(),
      tenant_id: pick(allTenantIds, i),
      agent_id: pick(agentKeysForTrace, i),
      session_id: `ses-${String(i % 30).padStart(4, '0')}`,
      input_tokens: 100 + (i % 900),
      output_tokens: 50 + (i % 450),
      latency_ms: 200 + (i % 4800),
      status: pick(traceStatuses, i),
      at: hoursAgo(Math.floor(i / 8)),
    };
    addEntity('aiTraces', trace);
  }

  // ── Impersonation session (1 example) ─────────────────────────────────────

  const impersonation: T.ImpersonationSession = {
    id: nextImpersonationId(),
    super_admin_id: derrickId,
    tenant_id: acmeTenantId,
    user_id: userIds[1]!,
    reason: 'Support ticket #1234 — user reports incorrect role assignment',
    ticketRef: '#1234',
    started_at: hoursAgo(2),
    expires_at: hoursAgo(-1),
    scope: ['read', 'write'],
  };
  addEntity('impersonationSessions', impersonation);

  // ── Context — current user / tenant ──────────────────────────────────────
  store.setState({ currentUserId: derrickId, currentTenantId: acmeTenantId });
}
