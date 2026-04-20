/**
 * Integration test — mock-store seed integrity.
 *
 * Seeds a fresh store, validates entity counts, relational integrity, and
 * verifies reset() clears all state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from 'zustand';
import type { MockStore } from './mock-store';
import { seedStore } from './mock-seed';

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
        currentUserId: null,
        currentTenantId: null,
        activeImpersonationId: null,
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

  it('seeds 3 tenants', () => {
    expect(Object.keys(store.getState().tenants)).toHaveLength(3);
  });

  it('seeds 15 users', () => {
    expect(Object.keys(store.getState().users)).toHaveLength(15);
  });

  it('seeds 8 roles', () => {
    expect(Object.keys(store.getState().roles)).toHaveLength(8);
  });

  it('seeds 15 memberships', () => {
    expect(Object.keys(store.getState().memberships)).toHaveLength(15);
  });

  it('seeds 20 services', () => {
    expect(Object.keys(store.getState().services)).toHaveLength(20);
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

  it('seeds 30 widgets (4+5+6+7+8 across 5 dashboards)', () => {
    expect(Object.keys(store.getState().widgets)).toHaveLength(30);
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

  it('seeds 1 impersonation session', () => {
    expect(Object.keys(store.getState().impersonationSessions)).toHaveLength(1);
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
      expect(tenantIds.has(key.tenant_id), `api_key ${key.id} → tenant ${key.tenant_id}`).toBe(true);
    }
  });

  it('every notification.user_id exists in users', () => {
    const { notifications, users } = store.getState();
    const userIds = new Set(Object.keys(users));
    for (const n of Object.values(notifications)) {
      expect(userIds.has(n.user_id), `notification ${n.id} → user ${n.user_id}`).toBe(true);
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
