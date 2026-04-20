/**
 * Zustand mock store — in-browser relational data layer for Stage 1.
 *
 * All entity kinds are indexed by ID (Record<ID, T>) for O(1) lookup.
 * AuditEntry uses an ordered array because it is append-only.
 * Persisted to localStorage via Zustand persist middleware; version 1.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type * as T from './resources/types';

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

  // Plugins
  plugins: Record<T.ID, T.Plugin>;
  marketplaceListings: Record<T.ID, T.MarketplaceListing>;

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
  aiProviders: T.AiProvider;
  aiAgents: T.AiAgent;
  aiTools: T.AiTool;
  aiTraces: T.AiTrace;
  aiSemanticRateLimits: T.AiSemanticRateLimit;
  aiToolBindings: T.AiToolBinding;
  mcpServers: T.McpServer;
}

export type EntityKind = keyof EntityKindMap;

// ─── Actions ──────────────────────────────────────────────────────────────────

interface MockStoreActions {
  /**
   * Add a single entity to a Record-indexed collection.
   * The entity must have an `id` field.
   */
  addEntity<K extends EntityKind>(
    kind: K,
    entity: EntityKindMap[K] & { id: T.ID },
  ): void;

  /**
   * Merge a partial patch into an existing entity.
   * No-ops silently if the entity is not found.
   */
  updateEntity<K extends EntityKind>(
    kind: K,
    id: T.ID,
    patch: Partial<EntityKindMap[K]>,
  ): void;

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
    aiSemanticRateLimits: {},
    aiToolBindings: {},
    mcpServers: {},
    currentUserId: null,
    currentTenantId: null,
    activeImpersonationId: null,
    pendingAuthUserId: null,
  };
}

// ─── Store creation ───────────────────────────────────────────────────────────

export const useMockStore = create<MockStore>()(
  persist(
    (set, get) => ({
      ...emptyState(),

      addEntity<K extends EntityKind>(
        kind: K,
        entity: EntityKindMap[K] & { id: T.ID },
      ) {
        set((state) => ({
          [kind]: {
            ...(state[kind] as Record<T.ID, EntityKindMap[K]>),
            [entity.id]: entity,
          },
        }));
      },

      updateEntity<K extends EntityKind>(
        kind: K,
        id: T.ID,
        patch: Partial<EntityKindMap[K]>,
      ) {
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

      reset() {
        set(emptyState());
      },
    }),
    {
      name: 'rioku-mock-store',
      version: 5,
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
        return state as unknown as MockStore;
      },
    },
  ),
);
