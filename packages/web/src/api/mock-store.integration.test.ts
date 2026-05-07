/**
 * Integration test — mock-store seed integrity.
 *
 * Seeds a fresh store, validates entity counts, relational integrity, and
 * verifies reset() clears all state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'zustand';
import type { MockStore } from './mock-store';
import { useMockStore } from './mock-store';
import { seedStore } from './mock-seed';
import { deleteTenant, exportTenantJson } from '../features/settings/api';
import { _internals } from '../features/settings/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Merge emptyState manually to avoid importing the persisted singleton */
function makeFreshStore() {
  return createStore<MockStore>()((set, get) => ({
    users: {},
    tenants: {},
    memberships: {},
    roles: {},
    permissions: {},
    accessPolicies: {},
    rbacPolicies: {},
    services: {},
    routes: {},
    middlewares: {},
    apiKeys: {},
    sessions: {},
    impersonationSessions: {},
    audit: [],
    adminAudit: [],
    auditRetentionConfigs: {},
    tenantAuthPolicies: {},
    networkConfigs: {},
    sites: {},
    dashboards: {},
    widgets: {},
    dashboardVersions: {},
    userHomeDashboards: {},
    notifications: {},
    notificationChannels: {},
    notificationRoutingRules: {},
    notificationDeliveryLog: {},
    plugins: {},
    marketplaceListings: {},
    pluginSigners: {},
    aiProviders: {},
    aiAgents: {},
    aiTools: {},
    aiTraces: {},
    aiSemanticRateLimits: {},
    aiToolBindings: {},
    mcpServers: {},
    certAuthorities: {},
    certEnrollments: {},
    tlsCertificates: {},
    tlsConfigs: {},
    observabilityConfigs: {},
    webhookEndpoints: {},
    clusterNodes: {},
    clusterEnrollmentTokens: {},
    notificationConfigs: {},
    currentUserId: null,
    currentTenantId: null,
    activeImpersonationId: null,
    pendingAuthUserId: null,

    addEntity(kind, entity) {
      set((state) => ({
        [kind]: { ...(state[kind] as Record<string, unknown>), [entity.id]: entity },
      }));
    },
    updateEntity(kind, id, patch) {
      const current = (get()[kind] as Record<string, unknown>)[id];
      if (!current) return;
      set((state) => ({
        [kind]: {
          ...(state[kind] as Record<string, unknown>),
          [id]: { ...(current as object), ...(patch as object) },
        },
      }));
    },
    deleteEntity(kind, id) {
      set((state) => {
        const next = { ...(state[kind] as Record<string, unknown>) };
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete next[id];
        return { [kind]: next };
      });
    },
    appendAudit(entry) {
      set((state) => ({ audit: [...state.audit, entry] }));
    },
    appendAdminAudit(entry) {
      set((state) => ({ adminAudit: [...state.adminAudit, entry] }));
    },
    reset() {
      set({
        users: {},
        tenants: {},
        memberships: {},
        roles: {},
        permissions: {},
        accessPolicies: {},
        rbacPolicies: {},
        services: {},
        routes: {},
        middlewares: {},
        apiKeys: {},
        sessions: {},
        impersonationSessions: {},
        audit: [],
        adminAudit: [],
        sites: {},
        dashboards: {},
        widgets: {},
        dashboardVersions: {},
        userHomeDashboards: {},
        notifications: {},
        notificationChannels: {},
        notificationRoutingRules: {},
        notificationDeliveryLog: {},
        plugins: {},
        marketplaceListings: {},
        aiProviders: {},
        aiAgents: {},
        aiTools: {},
        aiTraces: {},
        mcpServers: {},
        tenantAuthPolicies: {},
        networkConfigs: {},
        certAuthorities: {},
        certEnrollments: {},
        tlsCertificates: {},
        tlsConfigs: {},
        observabilityConfigs: {},
        webhookEndpoints: {},
        clusterNodes: {},
        clusterEnrollmentTokens: {},
        notificationConfigs: {},
        currentUserId: null,
        currentTenantId: null,
        activeImpersonationId: null,
      });
    },
    updateNetworkConfig(tenantId, patch) {
      set((state) => {
        const current = state.networkConfigs[tenantId];
        if (!current) return state;
        return {
          networkConfigs: {
            ...state.networkConfigs,
            [tenantId]: { ...current, ...patch },
          },
        };
      });
    },
    updateTenantAuthPolicy(tenantId, patch) {
      set((state) => {
        const current = state.tenantAuthPolicies[tenantId];
        if (!current) return state;
        return {
          tenantAuthPolicies: {
            ...state.tenantAuthPolicies,
            [tenantId]: { ...current, ...patch },
          },
        };
      });
    },
    addCertAuthority(ca) {
      set((state) => ({
        certAuthorities: { ...state.certAuthorities, [ca.id]: ca },
      }));
    },
    addCertEnrollment(enrollment) {
      set((state) => ({
        certEnrollments: { ...state.certEnrollments, [enrollment.id]: enrollment },
      }));
    },
    updateCertEnrollment(enrollmentId, patch) {
      set((state) => {
        const current = state.certEnrollments[enrollmentId];
        if (!current) return state;
        return {
          certEnrollments: {
            ...state.certEnrollments,
            [enrollmentId]: { ...current, ...patch },
          },
        };
      });
    },
    addTlsCertificate(cert) {
      set((state) => ({
        tlsCertificates: { ...state.tlsCertificates, [cert.id]: cert },
      }));
    },
    updateTlsCertificate(certId, patch) {
      set((state) => {
        const current = state.tlsCertificates[certId];
        if (!current) return state;
        return {
          tlsCertificates: {
            ...state.tlsCertificates,
            [certId]: { ...current, ...patch },
          },
        };
      });
    },
    deleteTlsCertificate(certId) {
      set((state) => {
        const next = { ...state.tlsCertificates };
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete next[certId];
        return { tlsCertificates: next };
      });
    },
    updateTlsConfig(tenantId, patch) {
      set((state) => {
        const current = state.tlsConfigs[tenantId];
        if (!current) return state;
        return {
          tlsConfigs: {
            ...state.tlsConfigs,
            [tenantId]: { ...current, ...patch },
          },
        };
      });
    },
    updateObservabilityConfig(tenantId, patch) {
      set((state) => {
        const current = state.observabilityConfigs[tenantId];
        if (!current) return state;
        const nextMetrics =
          patch.metrics != null ? { ...current.metrics, ...patch.metrics } : current.metrics;
        const nextLogs =
          patch.logs != null
            ? {
                ...current.logs,
                ...patch.logs,
                levels: { ...current.logs.levels, ...patch.logs.levels },
                rotation: { ...current.logs.rotation, ...patch.logs.rotation },
              }
            : current.logs;
        const nextTraces =
          patch.traces != null ? { ...current.traces, ...patch.traces } : current.traces;
        return {
          observabilityConfigs: {
            ...state.observabilityConfigs,
            [tenantId]: {
              ...current,
              metrics: nextMetrics,
              logs: nextLogs,
              traces: nextTraces,
              updated_at: new Date().toISOString(),
            },
          },
        };
      });
    },
    addWebhookEndpoint(endpoint) {
      set((state) => ({
        webhookEndpoints: { ...state.webhookEndpoints, [endpoint.id]: endpoint },
      }));
    },
    updateWebhookEndpoint(id, patch) {
      set((state) => {
        const current = state.webhookEndpoints[id];
        if (!current) return state;
        return {
          webhookEndpoints: {
            ...state.webhookEndpoints,
            [id]: { ...current, ...patch },
          },
        };
      });
    },
    deleteWebhookEndpoint(id) {
      set((state) => {
        const next = { ...state.webhookEndpoints };
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete next[id];
        return { webhookEndpoints: next };
      });
    },
    updateNotificationConfig(tenantId, patch) {
      set((state) => {
        const current = state.notificationConfigs[tenantId];
        if (!current) return state;
        return {
          notificationConfigs: {
            ...state.notificationConfigs,
            [tenantId]: { ...current, ...patch },
          },
        };
      });
    },
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mock-store seed integrity', () => {
  let store: ReturnType<typeof makeFreshStore>;

  beforeEach(() => {
    store = makeFreshStore();
    seedStore(store);
  });

  // ── Entity counts ──────────────────────────────────────────────────────────

  it('seeds 4 tenants', () => {
    expect(Object.keys(store.getState().tenants)).toHaveLength(4);
  });

  it('seeds 15 users', () => {
    expect(Object.keys(store.getState().users)).toHaveLength(15);
  });

  it('seeds 9 roles', () => {
    expect(Object.keys(store.getState().roles)).toHaveLength(9);
  });

  it('seeds 16 memberships', () => {
    // 15 original + Derrick's admin membership on the empty tenant
    expect(Object.keys(store.getState().memberships)).toHaveLength(16);
  });

  it('seeds 20 services', () => {
    expect(Object.keys(store.getState().services)).toHaveLength(20);
  });

  it('empty tenant has 0 services', () => {
    const { tenants, services } = store.getState();
    const emptyTenant = Object.values(tenants).find((t) => t.slug === 'empty');
    expect(emptyTenant).toBeDefined();
    if (!emptyTenant) return; // type guard — satisfied by toBeDefined above
    const emptyServices = Object.values(services).filter((s) => s.tenant_id === emptyTenant.id);
    expect(emptyServices).toHaveLength(0);
  });

  it('seeds 60 routes', () => {
    expect(Object.keys(store.getState().routes)).toHaveLength(60);
  });

  it('seeds 10 middlewares', () => {
    expect(Object.keys(store.getState().middlewares)).toHaveLength(10);
  });

  it('seeds 8 sites', () => {
    expect(Object.keys(store.getState().sites)).toHaveLength(8);
  });

  it('seeds 25 api keys', () => {
    expect(Object.keys(store.getState().apiKeys)).toHaveLength(25);
  });

  it('seeds 15 access policies', () => {
    expect(Object.keys(store.getState().accessPolicies)).toHaveLength(15);
  });

  it('seeds 6 rbac policies', () => {
    expect(Object.keys(store.getState().rbacPolicies)).toHaveLength(6);
  });

  it('seeds 30 sessions', () => {
    expect(Object.keys(store.getState().sessions)).toHaveLength(30);
  });

  it('seeds 300 audit entries', () => {
    expect(store.getState().audit).toHaveLength(300);
  });

  it('seeds 5 dashboards', () => {
    expect(Object.keys(store.getState().dashboards)).toHaveLength(5);
  });

  it('seeds 45 widgets (19+7+6+7+6 across 5 dashboards)', () => {
    // Overview dashboard (di=0) covers the whole Rioku system with 19
    // hand-crafted widgets (traffic, latency, errors, security, AI,
    // cluster). The audit-tail / log-viewer / service-map widgets were
    // pulled from the Overview — they live on their own routes already.
    // The other 4 dashboards retain their original rotated kinds:
    // API Health (7), Security (6), AI Usage (7), Billing (6).
    expect(Object.keys(store.getState().widgets)).toHaveLength(45);
  });

  it('seeds 15 dashboard versions (3 per dashboard)', () => {
    expect(Object.keys(store.getState().dashboardVersions)).toHaveLength(15);
  });

  it('seeds 4 plugins', () => {
    expect(Object.keys(store.getState().plugins)).toHaveLength(4);
  });

  it('seeds 20 marketplace listings', () => {
    expect(Object.keys(store.getState().marketplaceListings)).toHaveLength(20);
  });

  it('seeds 40 inbox notifications', () => {
    expect(Object.keys(store.getState().notifications)).toHaveLength(40);
  });

  it('seeds 6 notification channels', () => {
    expect(Object.keys(store.getState().notificationChannels)).toHaveLength(6);
  });

  it('seeds 8 routing rules', () => {
    expect(Object.keys(store.getState().notificationRoutingRules)).toHaveLength(8);
  });

  it('seeds 100 delivery log entries', () => {
    expect(Object.keys(store.getState().notificationDeliveryLog)).toHaveLength(100);
  });

  it('seeds 4 AI providers', () => {
    expect(Object.keys(store.getState().aiProviders)).toHaveLength(4);
  });

  it('seeds 6 AI agents', () => {
    expect(Object.keys(store.getState().aiAgents)).toHaveLength(6);
  });

  it('seeds 12 AI tools', () => {
    expect(Object.keys(store.getState().aiTools)).toHaveLength(12);
  });

  it('seeds 200 AI traces', () => {
    expect(Object.keys(store.getState().aiTraces)).toHaveLength(200);
  });

  it('seeds 3 MCP servers', () => {
    expect(Object.keys(store.getState().mcpServers)).toHaveLength(3);
  });

  it('seeds certAuthorities (3 internal + 1 external)', () => {
    const cas = Object.values(store.getState().certAuthorities);
    const internal = cas.filter((c) => c.kind === 'internal');
    const external = cas.filter((c) => c.kind === 'external');
    expect(cas.length).toBe(4);
    expect(internal.length).toBe(3);
    expect(external.length).toBe(1);
  });

  it('seeds 13 cert enrollments across tenants and states', () => {
    const enrollments = Object.values(store.getState().certEnrollments);
    expect(enrollments.length).toBe(13);
    // verify a spread of states exists
    expect(enrollments.some((e) => e.state === 'pending')).toBe(true);
    expect(enrollments.some((e) => e.state === 'issued')).toBe(true);
    expect(enrollments.some((e) => e.state === 'revoked')).toBe(true);
  });

  it('every cert enrollment references a valid ca_id (FK integrity)', () => {
    const { certAuthorities, certEnrollments } = store.getState();
    for (const enrollment of Object.values(certEnrollments)) {
      expect(certAuthorities[enrollment.ca_id]).toBeDefined();
    }
  });

  it('seeds 1 impersonation session', () => {
    expect(Object.keys(store.getState().impersonationSessions)).toHaveLength(1);
  });

  // ── TLS seed integrity ─────────────────────────────────────────────────────

  it('seeds 4 TLS certs per tenant (12 total)', () => {
    const certs = Object.values(store.getState().tlsCertificates);
    // 3 tenants × 4 certs each
    expect(certs.length).toBe(12);
  });

  it('every tlsCertificate has a valid tenant_id', () => {
    const { tlsCertificates, tenants } = store.getState();
    const tenantIds = new Set(Object.keys(tenants));
    for (const cert of Object.values(tlsCertificates)) {
      expect(tenantIds.has(cert.tenant_id), `tlsCert ${cert.id} → tenant ${cert.tenant_id}`).toBe(
        true,
      );
    }
  });

  it('seeds one TlsConfig per seeded tenant (excludes empty tenant)', () => {
    const { tlsConfigs, tenants } = store.getState();
    // The empty tenant has no seeded configs; check only the 3 data-bearing tenants.
    const seededTenantIds = Object.values(tenants)
      .filter((t) => t.slug !== 'empty')
      .map((t) => t.id);
    for (const tid of seededTenantIds) {
      expect(tlsConfigs[tid]).toBeDefined();
    }
    expect(Object.keys(tlsConfigs)).toHaveLength(seededTenantIds.length);
  });

  // ── Observability seed integrity ───────────────────────────────────────────

  it('seeds one ObservabilityConfig per seeded tenant (excludes empty tenant)', () => {
    const { observabilityConfigs, tenants } = store.getState();
    // The empty tenant has no seeded configs; check only the 3 data-bearing tenants.
    const seededTenantIds = Object.values(tenants)
      .filter((t) => t.slug !== 'empty')
      .map((t) => t.id);
    for (const tid of seededTenantIds) {
      expect(observabilityConfigs[tid]).toBeDefined();
    }
    expect(Object.keys(observabilityConfigs)).toHaveLength(seededTenantIds.length);
  });

  it('every ObservabilityConfig has valid sane defaults', () => {
    const { observabilityConfigs } = store.getState();
    for (const config of Object.values(observabilityConfigs)) {
      expect(config.metrics.scrape_endpoint).toBe('/metrics');
      expect(config.metrics.scrape_auth).toBe('bearer');
      expect(config.metrics.retention_days).toBe(30);
      expect(config.logs.levels.daemon).toBe('info');
      expect(config.logs.levels.caddy).toBe('info');
      expect(config.logs.levels.plugin).toBe('warn');
      expect(config.logs.format).toBe('json');
      expect(config.logs.rotation.compress).toBe(true);
      expect(config.traces.retention_days).toBe(7);
      expect(config.traces.sample_rate).toBe(0.1);
    }
  });

  // ── Relational integrity ───────────────────────────────────────────────────

  it('every membership.user_id exists in users', () => {
    const { memberships, users } = store.getState();
    const userIds = new Set(Object.keys(users));
    for (const m of Object.values(memberships)) {
      expect(userIds.has(m.user_id), `membership ${m.id} → user ${m.user_id}`).toBe(true);
    }
  });

  it('every membership.tenant_id exists in tenants', () => {
    const { memberships, tenants } = store.getState();
    const tenantIds = new Set(Object.keys(tenants));
    for (const m of Object.values(memberships)) {
      expect(tenantIds.has(m.tenant_id), `membership ${m.id} → tenant ${m.tenant_id}`).toBe(true);
    }
  });

  it('every route.service_id exists in services', () => {
    const { routes, services } = store.getState();
    const serviceIds = new Set(Object.keys(services));
    for (const r of Object.values(routes)) {
      expect(serviceIds.has(r.service_id), `route ${r.id} → service ${r.service_id}`).toBe(true);
    }
  });

  it('every session.user_id exists in users', () => {
    const { sessions, users } = store.getState();
    const userIds = new Set(Object.keys(users));
    for (const s of Object.values(sessions)) {
      expect(userIds.has(s.user_id), `session ${s.id} → user ${s.user_id}`).toBe(true);
    }
  });

  it('every role.parent_ids[] entry exists in roles', () => {
    const { roles } = store.getState();
    const roleIds = new Set(Object.keys(roles));
    for (const role of Object.values(roles)) {
      for (const parentId of role.parent_ids) {
        expect(roleIds.has(parentId), `role ${role.id} → parent_id ${parentId}`).toBe(true);
      }
    }
  });

  it('every api_key.tenant_id exists in tenants', () => {
    const { apiKeys, tenants } = store.getState();
    const tenantIds = new Set(Object.keys(tenants));
    for (const key of Object.values(apiKeys)) {
      expect(tenantIds.has(key.tenant_id), `api_key ${key.id} → tenant ${key.tenant_id}`).toBe(
        true,
      );
    }
  });

  it('every notification.user_id exists in users', () => {
    const { notifications, users } = store.getState();
    const userIds = new Set(Object.keys(users));
    for (const n of Object.values(notifications)) {
      expect(userIds.has(n.user_id), `notification ${n.id} → user ${n.user_id}`).toBe(true);
    }
  });

  // ── Webhook endpoint seed integrity ───────────────────────────────────────

  it('each seeded tenant has exactly 2 webhook endpoints (empty tenant has 0)', () => {
    const { webhookEndpoints, tenants } = store.getState();
    const seededTenantIds = Object.values(tenants)
      .filter((t) => t.slug !== 'empty')
      .map((t) => t.id);
    const emptyTenant = Object.values(tenants).find((t) => t.slug === 'empty');

    for (const tid of seededTenantIds) {
      const eps = Object.values(webhookEndpoints).filter((e) => e.tenant_id === tid);
      expect(eps.length).toBe(2);
    }
    if (emptyTenant) {
      const emptyEps = Object.values(webhookEndpoints).filter(
        (e) => e.tenant_id === emptyTenant.id,
      );
      expect(emptyEps.length).toBe(0);
    }
  });

  it('each webhook endpoint has a unique 32-char hex secret', () => {
    const { webhookEndpoints } = store.getState();
    const secrets = Object.values(webhookEndpoints).map((e) => e.secret);
    // All secrets are unique
    expect(new Set(secrets).size).toBe(secrets.length);
    // All secrets are 32 lowercase hex chars
    for (const secret of secrets) {
      expect(secret).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  // ── Reset ──────────────────────────────────────────────────────────────────

  it('reset() clears all entities', () => {
    store.getState().reset();
    const s = store.getState();
    expect(Object.keys(s.users)).toHaveLength(0);
    expect(Object.keys(s.tenants)).toHaveLength(0);
    expect(Object.keys(s.services)).toHaveLength(0);
    expect(s.audit).toHaveLength(0);
    expect(s.currentUserId).toBeNull();
    expect(s.currentTenantId).toBeNull();
  });
});

// ─── deleteTenant cascade integration ────────────────────────────────────────
//
// These tests use useMockStore (the singleton) because deleteTenant in api.ts
// operates on useMockStore.setState directly.

describe('deleteTenant cascade removes all tenant-scoped records', () => {
  beforeEach(() => {
    useMockStore.getState().reset();
    seedStore(useMockStore);
  });

  function getAcmeTenantId(): string {
    const state = useMockStore.getState();
    const tenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!tenant) throw new Error('Acme tenant not found in seed data');
    return tenant.id;
  }

  it('removes the tenant record', async () => {
    const tenantId = getAcmeTenantId();
    await deleteTenant(tenantId);
    expect(useMockStore.getState().tenants[tenantId]).toBeUndefined();
  });

  it('cascade-removes services for the deleted tenant', async () => {
    const tenantId = getAcmeTenantId();
    await deleteTenant(tenantId);
    const remaining = Object.values(useMockStore.getState().services).filter(
      (x) => x.tenant_id === tenantId,
    );
    expect(remaining).toHaveLength(0);
  });

  it('cascade-removes routes for the deleted tenant (via parent service)', async () => {
    const tenantId = getAcmeTenantId();
    const state = useMockStore.getState();
    // Count routes that belong to this tenant (via service).
    const beforeRouteCount = Object.values(state.routes).filter((r) => {
      const svc = state.services[r.service_id];
      return svc?.tenant_id === tenantId;
    }).length;
    expect(beforeRouteCount).toBeGreaterThan(0);

    await deleteTenant(tenantId);

    const afterState = useMockStore.getState();
    const afterRoutes = Object.values(afterState.routes).filter((r) => {
      const svc = afterState.services[r.service_id];
      return svc?.tenant_id === tenantId;
    });
    expect(afterRoutes).toHaveLength(0);
  });

  it('cascade-removes memberships for the deleted tenant', async () => {
    const tenantId = getAcmeTenantId();
    await deleteTenant(tenantId);
    const remaining = Object.values(useMockStore.getState().memberships).filter(
      (m) => m.tenant_id === tenantId,
    );
    expect(remaining).toHaveLength(0);
  });

  it('cascade-removes webhook endpoints for the deleted tenant', async () => {
    const tenantId = getAcmeTenantId();
    await deleteTenant(tenantId);
    const remaining = Object.values(useMockStore.getState().webhookEndpoints).filter(
      (x) => x.tenant_id === tenantId,
    );
    expect(remaining).toHaveLength(0);
  });

  it('leaves other tenants and their records intact', async () => {
    const tenantId = getAcmeTenantId();
    const stateBefore = useMockStore.getState();
    // All tenants except the one being deleted
    const otherTenants = Object.values(stateBefore.tenants).filter((t) => t.id !== tenantId);
    // Tenants with seeded data (beta + gamma; not the empty tenant)
    const seededOtherTenants = otherTenants.filter((t) => t.slug !== 'empty');
    expect(otherTenants.length).toBeGreaterThan(0);

    await deleteTenant(tenantId);

    const stateAfter = useMockStore.getState();
    for (const t of otherTenants) {
      expect(stateAfter.tenants[t.id]).toBeDefined();
    }
    // Only seeded tenants should have services
    for (const t of seededOtherTenants) {
      const services = Object.values(stateAfter.services).filter((s) => s.tenant_id === t.id);
      expect(services.length).toBeGreaterThan(0);
    }
  });

  it('exportTenantJson creates Blob with tenant data', async () => {
    const tenantId = getAcmeTenantId();

    let capturedBlob: Blob | null = null;
    let capturedFilename: string | null = null;

    // Uses _internals indirection so the spy works in ESM (same-module calls
    // bypass the module-namespace replacement that vi.spyOn(module, fn) does).
    vi.spyOn(_internals, '_triggerBlobDownload').mockImplementation(
      (blob: Blob, filename: string) => {
        capturedBlob = blob;
        capturedFilename = filename;
      },
    );

    await exportTenantJson(tenantId);

    expect(capturedBlob).not.toBeNull();
     
    const blob: Blob = capturedBlob!;
    expect(blob.type).toBe('application/json');
    expect(capturedFilename).toMatch(/^acme-export-/);

    const text = await blob.text();
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(data.tenant).toBeDefined();
    expect((data.tenant as Record<string, unknown>).id).toBe(tenantId);

    vi.restoreAllMocks();
  });
});
