/**
 * Zustand mock store — in-browser relational data layer for Stage 1.
 *
 * All entity kinds are indexed by ID (Record<ID, T>) for O(1) lookup.
 * AuditEntry uses an ordered array because it is append-only.
 * Persisted to localStorage via Zustand persist middleware; version 1.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type * as T from '../resources';

// ─── State shape ──────────────────────────────────────────────────────────────

interface MockStoreState {
  // Identity
  users: Record<T.ID, T.User>;
  tenants: Record<T.ID, T.Tenant>;
  memberships: Record<T.ID, T.Membership>;

  // RBAC
  roles: Record<T.ID, T.Role>;
  permissions: Record<string, T.Permission>;
  accessPolicies: Record<T.ID, T.AccessPolicy>;
  rbacPolicies: Record<T.ID, T.RbacPolicy>;

  // API management
  services: Record<T.ID, T.Service>;
  routes: Record<T.ID, T.Route>;
  middlewares: Record<T.ID, T.Middleware>;

  // Keys + sessions
  apiKeys: Record<T.ID, T.ApiKey>;
  sessions: Record<T.ID, T.Session>;
  impersonationSessions: Record<T.ID, T.ImpersonationSession>;

  // Audit — ordered, append-only
  audit: T.AuditEntry[];
  // Super-admin cross-tenant audit — separate hash-chained log
  adminAudit: T.AdminAuditEntry[];
  // Audit retention config — keyed by tenant_id, at most one per tenant
  auditRetentionConfigs: Record<T.ID, T.AuditRetentionConfig>;
  // Auth policy — keyed by tenant_id, at most one per tenant
  tenantAuthPolicies: Record<T.ID, T.TenantAuthPolicy>;
  // Network config — keyed by tenant_id, at most one per tenant
  networkConfigs: Record<T.ID, T.NetworkConfig>;

  // PKI — Certificate Authorities + Enrollments
  certAuthorities: Record<T.ID, T.CertAuthority>;
  certEnrollments: Record<T.ID, T.CertEnrollment>;

  // TLS — Certificates + per-tenant config
  tlsCertificates: Record<T.ID, T.TlsCertificate>;
  tlsConfigs: Record<T.ID, T.TlsConfig>;

  // Observability — per-tenant config
  observabilityConfigs: Record<T.ID, T.ObservabilityConfig>;

  // Integrations — inbound webhook endpoints
  webhookEndpoints: Record<T.ID, T.WebhookEndpoint>;

  // Cluster — nodes and enrollment tokens (Plan 10)
  clusterNodes: Record<T.ID, T.ClusterNode>;
  clusterEnrollmentTokens: Record<T.ID, T.ClusterEnrollmentToken>;

  // Sites
  sites: Record<T.ID, T.Site>;

  // Dashboards + widgets
  dashboards: Record<T.ID, T.Dashboard>;
  widgets: Record<T.ID, T.Widget>;
  dashboardVersions: Record<T.ID, T.DashboardVersion>;
  /** Per-user "my home" dashboard override. Keyed by user id. */
  userHomeDashboards: Record<T.ID, T.ID>;

  // Notifications
  notifications: Record<T.ID, T.NotificationItem>;
  notificationChannels: Record<T.ID, T.NotificationChannel>;
  notificationRoutingRules: Record<T.ID, T.NotificationRoutingRule>;
  notificationDeliveryLog: Record<T.ID, T.NotificationDeliveryLogEntry>;
  // Tenant-scoped notification config — keyed by tenant_id, at most one per tenant
  notificationConfigs: Record<T.ID, T.TenantNotificationConfig>;

  // Plugins
  plugins: Record<T.ID, T.Plugin>;
  marketplaceListings: Record<T.ID, T.MarketplaceListing>;
  pluginSigners: Record<T.ID, T.PluginSigner>;

  // AI
  aiProviders: Record<T.ID, T.AiProvider>;
  aiAgents: Record<T.ID, T.AiAgent>;
  aiTools: Record<T.ID, T.AiTool>;
  aiTraces: Record<T.ID, T.AiTrace>;
  aiSemanticRateLimits: Record<T.ID, T.AiSemanticRateLimit>;
  aiToolBindings: Record<T.ID, T.AiToolBinding>;
  mcpServers: Record<T.ID, T.McpServer>;

  // Session context
  currentUserId: T.ID | null;
  currentTenantId: T.ID | null;
  activeImpersonationId: T.ID | null;

  // Transient auth state (not persisted semantically — cleared on successful auth)
  /** userId waiting for TOTP confirmation between login step 1 and step 2 */
  pendingAuthUserId: T.ID | null;
}

// ─── Entity kind union (for generic CRUD actions) ─────────────────────────────

/** Map of kind → entity type — used by generic CRUD actions */
interface EntityKindMap {
  users: T.User;
  tenants: T.Tenant;
  memberships: T.Membership;
  roles: T.Role;
  permissions: T.Permission;
  accessPolicies: T.AccessPolicy;
  rbacPolicies: T.RbacPolicy;
  services: T.Service;
  routes: T.Route;
  middlewares: T.Middleware;
  apiKeys: T.ApiKey;
  sessions: T.Session;
  impersonationSessions: T.ImpersonationSession;
  sites: T.Site;
  dashboards: T.Dashboard;
  widgets: T.Widget;
  dashboardVersions: T.DashboardVersion;
  notifications: T.NotificationItem;
  notificationChannels: T.NotificationChannel;
  notificationRoutingRules: T.NotificationRoutingRule;
  notificationDeliveryLog: T.NotificationDeliveryLogEntry;
  plugins: T.Plugin;
  marketplaceListings: T.MarketplaceListing;
  pluginSigners: T.PluginSigner;
  aiProviders: T.AiProvider;
  aiAgents: T.AiAgent;
  aiTools: T.AiTool;
  aiTraces: T.AiTrace;
  aiSemanticRateLimits: T.AiSemanticRateLimit;
  aiToolBindings: T.AiToolBinding;
  mcpServers: T.McpServer;
  certAuthorities: T.CertAuthority;
  certEnrollments: T.CertEnrollment;
  tlsCertificates: T.TlsCertificate;
  clusterNodes: T.ClusterNode;
  clusterEnrollmentTokens: T.ClusterEnrollmentToken;
}

export type EntityKind = keyof EntityKindMap;

// ─── Actions ──────────────────────────────────────────────────────────────────

interface MockStoreActions {
  /**
   * Add a single entity to a Record-indexed collection.
   * The entity must have an `id` field.
   */
  addEntity<K extends EntityKind>(kind: K, entity: EntityKindMap[K] & { id: T.ID }): void;

  /**
   * Merge a partial patch into an existing entity.
   * No-ops silently if the entity is not found.
   */
  updateEntity<K extends EntityKind>(kind: K, id: T.ID, patch: Partial<EntityKindMap[K]>): void;

  /**
   * Remove an entity by ID from a Record-indexed collection.
   */
  deleteEntity(kind: EntityKind, id: T.ID): void;

  /**
   * Append an audit entry to the ordered audit log.
   */
  appendAudit(entry: T.AuditEntry): void;

  /**
   * Append an entry to the super-admin cross-tenant audit log.
   */
  appendAdminAudit(entry: T.AdminAuditEntry): void;

  /**
   * Atomically apply a partial patch to a TenantAuthPolicy.
   * No-ops silently if no policy exists for the tenant yet.
   */
  updateTenantAuthPolicy(
    tenantId: T.ID,
    patch: Partial<Omit<T.TenantAuthPolicy, 'tenant_id'>>,
  ): void;

  /**
   * Atomically apply a partial patch to a NetworkConfig.
   * No-ops silently if no config exists for the tenant yet.
   */
  updateNetworkConfig(tenantId: T.ID, patch: Partial<Omit<T.NetworkConfig, 'tenant_id'>>): void;

  /**
   * Add a new CertAuthority to the store.
   */
  addCertAuthority(ca: T.CertAuthority): void;

  /**
   * Add a new CertEnrollment to the store.
   */
  addCertEnrollment(enrollment: T.CertEnrollment): void;

  /**
   * Atomically apply a partial patch to a CertEnrollment.
   * No-ops silently if the enrollment is not found.
   */
  updateCertEnrollment(
    enrollmentId: T.ID,
    patch: Partial<Omit<T.CertEnrollment, 'id' | 'tenant_id' | 'ca_id'>>,
  ): void;

  /**
   * Add a new TlsCertificate to the store.
   */
  addTlsCertificate(cert: T.TlsCertificate): void;

  /**
   * Atomically apply a partial patch to a TlsCertificate.
   * No-ops silently if the cert is not found.
   */
  updateTlsCertificate(
    certId: T.ID,
    patch: Partial<Omit<T.TlsCertificate, 'id' | 'tenant_id'>>,
  ): void;

  /**
   * Remove a TlsCertificate by ID.
   */
  deleteTlsCertificate(certId: T.ID): void;

  /**
   * Atomically apply a partial patch to a TlsConfig.
   * No-ops silently if no config exists for the tenant.
   */
  updateTlsConfig(tenantId: T.ID, patch: Partial<Omit<T.TlsConfig, 'tenant_id'>>): void;

  /**
   * Deep-merge a patch into an ObservabilityConfig.
   * Sub-objects (metrics, logs, traces) are shallow-merged individually.
   * No-ops silently if no config exists for the tenant.
   */
  updateObservabilityConfig(
    tenantId: T.ID,
    patch: Partial<Omit<T.ObservabilityConfig, 'tenant_id' | 'updated_at'>>,
  ): void;

  /**
   * Add a new WebhookEndpoint to the store.
   */
  addWebhookEndpoint(endpoint: T.WebhookEndpoint): void;

  /**
   * Apply a partial patch to a WebhookEndpoint.
   * No-ops silently if the endpoint is not found.
   */
  updateWebhookEndpoint(
    id: T.ID,
    patch: Partial<Omit<T.WebhookEndpoint, 'id' | 'tenant_id' | 'created_at'>>,
  ): void;

  /**
   * Remove a WebhookEndpoint by ID.
   */
  deleteWebhookEndpoint(id: T.ID): void;

  /**
   * Atomically apply a partial patch to a TenantNotificationConfig.
   * No-ops silently if no config exists for the tenant yet.
   */
  updateNotificationConfig(
    tenantId: T.ID,
    patch: Partial<Omit<T.TenantNotificationConfig, 'tenant_id' | 'updated_at'>>,
  ): void;

  /**
   * Reset the entire store to empty state (useful for re-seeding).
   */
  reset(): void;
}

// ─── Full store type ──────────────────────────────────────────────────────────

export type MockStore = MockStoreState & MockStoreActions;

// ─── Empty state factory ──────────────────────────────────────────────────────

function emptyState(): MockStoreState {
  return {
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
    notificationConfigs: {},
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
    clusterNodes: {},
    clusterEnrollmentTokens: {},
    tlsConfigs: {},
    observabilityConfigs: {},
    webhookEndpoints: {},
    currentUserId: null,
    currentTenantId: null,
    activeImpersonationId: null,
    pendingAuthUserId: null,
  };
}

// ─── Store creation ───────────────────────────────────────────────────────────

// Under Vitest the persist middleware becomes an expensive hot path: every
// `addEntity` / `appendAudit` call triggers a full JSON.stringify of the
// store (hundreds of entities after seeding). Running 16+ tests each with a
// `reset()` + `seedStore()` in `beforeEach` produces thousands of full-state
// serializations, which overwhelms the default 2 GB Node heap. Tests don't
// need persistence, so skip the middleware entirely when Vitest is active.
// Note: `import.meta.env.VITEST` is NOT populated by Vitest 4 (only MODE is
// set to "test"), so we read `process.env.VITEST` via `globalThis`. The web
// tsconfig intentionally omits `@types/node`, so we access `process` through
// an unknown-cast to avoid polluting the browser-facing type surface.
const IS_VITEST = (() => {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITEST === 'true';
})();

const storeInitializer = (
  set: (
    partial:
      | MockStore
      | Partial<MockStore>
      | ((state: MockStore) => MockStore | Partial<MockStore>),
  ) => void,
  get: () => MockStore,
): MockStore => ({
  ...emptyState(),

  addEntity<K extends EntityKind>(kind: K, entity: EntityKindMap[K] & { id: T.ID }) {
    set((state) => ({
      [kind]: {
        ...(state[kind] as Record<T.ID, EntityKindMap[K]>),
        [entity.id]: entity,
      },
    }));
  },

  updateEntity<K extends EntityKind>(kind: K, id: T.ID, patch: Partial<EntityKindMap[K]>) {
    const current = (get()[kind] as Record<T.ID, EntityKindMap[K]>)[id];
    if (!current) return;
    set((state) => ({
      [kind]: {
        ...(state[kind] as Record<T.ID, EntityKindMap[K]>),
        [id]: { ...current, ...patch },
      },
    }));
  },

  deleteEntity(kind: EntityKind, id: T.ID) {
    set((state) => {
      const next = {
        ...(state[kind] as Record<T.ID, EntityKindMap[typeof kind]>),
      };
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete next[id];
      return { [kind]: next };
    });
  },

  appendAudit(entry: T.AuditEntry) {
    set((state) => ({ audit: [...state.audit, entry] }));
  },

  appendAdminAudit(entry: T.AdminAuditEntry) {
    set((state) => ({ adminAudit: [...state.adminAudit, entry] }));
  },

  updateTenantAuthPolicy(tenantId: T.ID, patch: Partial<Omit<T.TenantAuthPolicy, 'tenant_id'>>) {
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

  updateNetworkConfig(tenantId: T.ID, patch: Partial<Omit<T.NetworkConfig, 'tenant_id'>>) {
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

  addCertAuthority(ca: T.CertAuthority) {
    set((state) => ({
      certAuthorities: { ...state.certAuthorities, [ca.id]: ca },
    }));
  },

  addCertEnrollment(enrollment: T.CertEnrollment) {
    set((state) => ({
      certEnrollments: { ...state.certEnrollments, [enrollment.id]: enrollment },
    }));
  },

  updateCertEnrollment(
    enrollmentId: T.ID,
    patch: Partial<Omit<T.CertEnrollment, 'id' | 'tenant_id' | 'ca_id'>>,
  ) {
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

  addTlsCertificate(cert: T.TlsCertificate) {
    set((state) => ({
      tlsCertificates: { ...state.tlsCertificates, [cert.id]: cert },
    }));
  },

  updateTlsCertificate(certId: T.ID, patch: Partial<Omit<T.TlsCertificate, 'id' | 'tenant_id'>>) {
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

  deleteTlsCertificate(certId: T.ID) {
    set((state) => {
      const next = { ...state.tlsCertificates };
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete next[certId];
      return { tlsCertificates: next };
    });
  },

  updateTlsConfig(tenantId: T.ID, patch: Partial<Omit<T.TlsConfig, 'tenant_id'>>) {
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

  updateObservabilityConfig(
    tenantId: T.ID,
    patch: Partial<Omit<T.ObservabilityConfig, 'tenant_id' | 'updated_at'>>,
  ) {
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

  addWebhookEndpoint(endpoint: T.WebhookEndpoint) {
    set((state) => ({
      webhookEndpoints: { ...state.webhookEndpoints, [endpoint.id]: endpoint },
    }));
  },

  updateWebhookEndpoint(
    id: T.ID,
    patch: Partial<Omit<T.WebhookEndpoint, 'id' | 'tenant_id' | 'created_at'>>,
  ) {
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

  deleteWebhookEndpoint(id: T.ID) {
    set((state) => {
      const next = { ...state.webhookEndpoints };
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete next[id];
      return { webhookEndpoints: next };
    });
  },

  updateNotificationConfig(
    tenantId: T.ID,
    patch: Partial<Omit<T.TenantNotificationConfig, 'tenant_id' | 'updated_at'>>,
  ) {
    set((state) => {
      const current = state.notificationConfigs[tenantId];
      if (!current) return state;
      return {
        notificationConfigs: {
          ...state.notificationConfigs,
          [tenantId]: { ...current, ...patch, updated_at: new Date().toISOString() },
        },
      };
    });
  },

  reset() {
    set(emptyState());
  },
});

export const useMockStore = IS_VITEST
  ? create<MockStore>()(storeInitializer)
  : create<MockStore>()(
      persist(storeInitializer, {
        name: 'rioku-mock-store',
        version: 18,
        storage: createJSONStorage(() => {
          // Fall back to a no-op storage in environments without localStorage
          // (e.g. SSR, certain test runners). Persist still works in-memory.
          if (typeof window === 'undefined') {
            return {
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
            };
          }
          return window.localStorage;
        }),
        migrate: (persistedState, version) => {
          const state = persistedState as Record<string, unknown>;
          // Version 3 — add totp_enrolled, backup_codes, force_password_change
          // to existing User records; fill pendingAuthUserId if absent.
          if (version < 3) {
            const users = (state.users ?? {}) as Record<string, Record<string, unknown>>;
            for (const [id, user] of Object.entries(users)) {
              users[id] = {
                totp_enrolled: user.totp_enabled ?? false,
                force_password_change: false,
                ...user,
              };
            }
            state.users = users;
            state.pendingAuthUserId = null;
          }
          // Version 4 — add aiSemanticRateLimits + aiToolBindings maps; older
          // stores drop their persisted AI data (Plan 3 expanded types made old
          // seeds incompatible).
          if (version < 4) {
            state.aiProviders = {};
            state.aiAgents = {};
            state.aiTools = {};
            state.aiTraces = {};
            state.mcpServers = {};
            state.aiSemanticRateLimits = {};
            state.aiToolBindings = {};
          }
          // Version 5 — Plan 4 expanded dashboards + widgets shape; older seeds
          // lack mode/scope/layout/variables/data_source/wizard_state. Drop and re-seed.
          if (version < 5) {
            state.dashboards = {};
            state.widgets = {};
            state.dashboardVersions = {};
            state.userHomeDashboards = {};
          }
          // Version 6 — Plan 5 adds auditRetentionConfigs (tenant_id → config).
          // Additive; persisted stores from v5 simply get an empty map.
          if (version < 6) {
            state.auditRetentionConfigs = {};
          }
          // Version 7 — Plan 6 extends Plugin (build_state, cosign_verified,
          // signer_id, last_build_log, sbom_uri) and adds pluginSigners map.
          // Drop and re-seed plugins so the required new fields are populated
          // from the current seed data, and initialise pluginSigners to {}.
          if (version < 7) {
            state.plugins = {};
            state.marketplaceListings = {};
            state.pluginSigners = {};
          }
          // Version 8 — Plan 7 extends NotificationItem + NotificationChannel
          // + NotificationRoutingRule + NotificationDeliveryLogEntry with new
          // required fields (tenant_id, severity, read_at/archived_at, at,
          // order_hint, attempts, first/last_attempted_at). Older seeds lack
          // these fields; drop and let the seeder repopulate.
          if (version < 8) {
            state.notifications = {};
            state.notificationChannels = {};
            state.notificationRoutingRules = {};
            state.notificationDeliveryLog = {};
          }
          // Version 9 — Plan 8a adds tenantAuthPolicies (tenant_id → policy).
          // Additive; persisted stores from v8 simply get an empty map.
          if (version < 9) {
            state.tenantAuthPolicies = {};
          }
          // Version 10 — Plan 8b adds networkConfigs (tenant_id → config).
          // Additive; persisted stores from v9 simply get an empty map.
          if (version < 10) {
            state.networkConfigs = {};
          }
          // Version 11 — Plan 8b.7 adds certAuthorities + certEnrollments maps.
          // Additive; persisted stores from v10 simply get empty maps.
          if (version < 11) {
            state.certAuthorities = {};
            state.certEnrollments = {};
          }
          // Version 12 — Plan 8b.8 adds tlsCertificates + tlsConfigs maps.
          // Additive; persisted stores from v11 simply get empty maps.
          if (version < 12) {
            state.tlsCertificates = {};
            state.tlsConfigs = {};
          }
          // Version 13 — Plan 8b.9 adds observabilityConfigs map.
          // Additive; persisted stores from v12 simply get an empty map.
          if (version < 13) {
            state.observabilityConfigs = {};
          }
          // Version 14 — Plan 8c.11 adds webhookEndpoints map.
          // Additive; persisted stores from v13 simply get an empty map.
          if (version < 14) {
            state.webhookEndpoints = {};
          }
          // Version 15 — Plan 10 adds clusterNodes + clusterEnrollmentTokens maps.
          // Additive; persisted stores from v14 simply get empty maps.
          if (version < 15) {
            state.clusterNodes = {};
            state.clusterEnrollmentTokens = {};
          }
          // Version 16 — Plan 8 adds notificationConfigs (tenant_id → config).
          // Additive; persisted stores from v15 simply get an empty map.
          if (version < 16) {
            state.notificationConfigs = {};
          }
          // Version 17 — Overview dashboard rebuilt with 22 widgets spanning
          // the whole Rioku system (new kinds: kpi-card, gauge, heatmap,
          // area-chart, status-grid). Drop persisted dashboards + widgets so
          // the seeder repopulates against the current layout spec.
          if (version < 17) {
            state.dashboards = {};
            state.widgets = {};
            state.dashboardVersions = {};
            state.userHomeDashboards = {};
          }
          // Version 18 — Overview trimmed (audit-tail / log-viewer /
          // service-map removed), pie + top-n widget configs updated for
          // HTTP method / error-rate accent hints. Force another reseed so
          // everyone gets the new layout and widget configs.
          if (version < 18) {
            state.dashboards = {};
            state.widgets = {};
            state.dashboardVersions = {};
            state.userHomeDashboards = {};
          }
          return state as unknown as MockStore;
        },
      }),
    );
