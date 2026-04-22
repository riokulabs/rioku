/**
 * Resource types for the Rioku mock store.
 * All IDs are strings. readonly applied to immutable fields.
 * This file must NOT import from outside lib/ or plain TS types.
 */

export type ID = string;

// ─── Core identity ────────────────────────────────────────────────────────────

export interface User {
  readonly id: ID;
  email: string;
  name: string;
  disabled: boolean;
  /** Legacy alias — kept for compatibility; use totp_enrolled for auth flow. */
  totp_enabled: boolean;
  /** True once the user has completed TOTP enrollment. */
  totp_enrolled: boolean;
  /** Mock: stored in plain text. Real daemon stores as TOTP secret (base32). */
  totp_secret?: string;
  /** Unused backup codes (plain for mock; hashed in real). */
  backup_codes?: string[];
  /** User must change password on next login. */
  force_password_change?: boolean;
  /** Optional profile avatar URL. If absent, UI falls back to initials. */
  avatar_url?: string;
  /** IANA timezone string, e.g. 'America/Los_Angeles'. */
  timezone: string;
  /** BCP 47 locale code, e.g. 'en' | 'ar'. */
  locale: string;
  /** When true, animations and transitions are suppressed in the UI. */
  reduced_motion: boolean;
  /** Per-channel and per-category notification preferences. */
  notification_preferences: {
    email: boolean;
    in_app: boolean;
    categories_muted: string[];
  };
  readonly created_at: string;
  updated_at: string;
}

export interface Tenant {
  readonly id: ID;
  slug: string; // displayed read-only in UI
  name: string;
  /** Hex accent color, e.g. '#22c55e' */
  accent: string;
  plan: 'community' | 'pro' | 'enterprise';
  /** URL-addressing mode. `path` = `/t/<slug>/...`, `subdomain` = `<slug>.example.com`. */
  url_mode: 'path' | 'subdomain';
  /** Name of the registered theme (matches RegisteredTheme.name from @/theme). Optional — fallback is the system default. */
  default_theme?: string;
  /** URL or data URI of tenant logo. Empty string = cleared (same sentinel as avatar). */
  logo_url?: string;
  readonly created_at: string;
  updated_at: string;
}

export interface Membership {
  readonly id: ID;
  readonly tenant_id: ID;
  readonly user_id: ID;
  role_ids: ID[];
  state: 'pending' | 'active' | 'deactivated' | 'removed';
  readonly invited_at: string;
  joined_at?: string;
  invite_token?: string;
  invite_expires_at?: string;
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

export interface Grant {
  permission: string;
  /** Optional CEL expression evaluated at request time */
  when?: string;
}

export interface Role {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  parent_ids: ID[];
  grants: Grant[];
  denies: string[];
  system: boolean;
}

export interface Permission {
  readonly key: string;
  description: string;
  source: 'built-in' | 'plugin-manifest' | 'plugin-dynamic';
  default_roles?: string[];
}

export interface AccessPolicy {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  /** CEL expression */
  condition: string;
  action: 'allow' | 'deny';
  priority: number;
  enabled: boolean;
  readonly created_at: string;
}

export interface RbacPolicy {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  role_id: ID;
  subject_kind: 'user' | 'group' | 'service-account';
  subject_id: ID;
  readonly created_at: string;
}

// ─── API management ───────────────────────────────────────────────────────────

export interface Service {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  upstream: string;
  env: string;
  health: 'healthy' | 'degraded' | 'unhealthy' | 'disabled';
  readonly created_at: string;
  // Plan 2 additions:
  description?: string;
  upstream_protocol: 'http' | 'https' | 'grpc';
  health_check?: { path: string; interval_seconds: number; timeout_seconds: number };
  tags: string[];
  last_reloaded_at?: string;
}

export interface Route {
  readonly id: ID;
  readonly service_id: ID;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ANY';
  policies: ID[];
  middleware_ids: ID[];
  // Plan 2 additions:
  name: string;
  match_kind: 'prefix' | 'exact' | 'regex';
  strip_prefix: boolean;
  rewrite_path?: string;
  headers_add: Record<string, string>;
  headers_remove: string[];
  enabled: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface Middleware {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  kind: 'rate-limit' | 'auth' | 'transform' | 'cors' | 'cache' | 'logging' | 'custom';
  config: Record<string, unknown>;
  enabled: boolean;
  // Plan 2 additions:
  description?: string;
  order_hint: number;
  readonly created_at: string;
}

// ─── Keys + sessions ──────────────────────────────────────────────────────────

export interface ApiKey {
  readonly id: ID;
  readonly tenant_id: ID;
  readonly user_id?: ID;
  name: string;
  /** Displayable key prefix, e.g. `sk_acme_ab` — full value never stored after creation */
  prefix: string;
  scope: string[];
  last_used?: string;
  expires_at?: string;
  revoked: boolean;
  readonly created_at: string;
}

export interface Session {
  readonly id: ID;
  readonly user_id: ID;
  readonly tenant_id: ID;
  ip: string;
  user_agent: string;
  last_seen: string;
  expires_at: string;
  revoked: boolean;
}

export interface ImpersonationSession {
  readonly id: ID;
  readonly super_admin_id: ID;
  readonly tenant_id: ID;
  user_id?: ID;
  reason: string;
  ticketRef?: string;
  readonly started_at: string;
  expires_at: string;
  scope: string[];
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  readonly id: ID;
  readonly tenant_id: ID | null;
  readonly actor_id: ID;
  action: string;
  resource_type: string;
  resource_id?: ID;
  outcome: 'success' | 'denied' | 'error';
  readonly at: string;
  tier: 'read' | 'read-sensitive' | 'write' | 'destructive';
  impersonation_session_id?: ID;
  /** Set to true when a super-admin action is reflected into the tenant log */
  acted_as_admin?: boolean;
  payload?: unknown;
  diff?: { before: unknown; after: unknown };
  // Plan 5 additions:
  /** Correlates this audit entry with a gateway request id. */
  request_id?: string;
  /** Caller IP as observed at the gateway. Sensitive — masked without `audit:read-sensitive`. */
  ip?: string;
  /** Caller user-agent string. Sensitive — masked without `audit:read-sensitive`. */
  user_agent?: string;
  /** True when the actor confirmed TOTP within this request's auth chain. */
  totp_verified?: boolean;
  /** Access + RBAC policies evaluated for this request, with per-policy decision. */
  policies_evaluated?: {
    readonly policy_id: ID;
    decision: 'allow' | 'deny';
    reason?: string;
  }[];
}

/**
 * Tenant-scoped audit retention configuration.
 *
 * One row per tenant controls how long audit entries are kept (per tier) and
 * how / whether they are auto-exported. Enforcement is a Stage 2+ daemon cron
 * — Stage 1 only persists the policy.
 */
export interface AuditRetentionConfig {
  readonly tenant_id: ID;
  /** Days to retain per tier. */
  retention_days: {
    read: number;
    'read-sensitive': number;
    write: number;
    destructive: number;
  };
  /** Export cadence. `never` disables the auto-export job. */
  auto_export: 'daily' | 'weekly' | 'monthly' | 'never';
  auto_export_format: 'csv' | 'jsonl';
  readonly updated_at: string;
}

/**
 * Per-tenant authentication policy. Applies to all users in the tenant
 * except where super-admin overrides.
 */
export interface TenantAuthPolicy {
  readonly tenant_id: ID;
  /** TOTP enforcement. `all`=every user, `admins`=admin-role users only, `optional`=per-user choice. */
  totp_policy: 'all' | 'admins' | 'optional';
  password_policy: {
    min_length: number; // 6..128
    require_uppercase: boolean;
    require_digit: boolean;
    require_symbol: boolean;
    max_age_days: number; // 0 = never expires
    history_depth: number; // 0..24
  };
  session_timeouts: {
    idle_hours: number; // 0..168 (7 days)
    absolute_hours: number; // 1..720 (30 days)
  };
  readonly updated_at: string;
}

/**
 * Per-tenant network configuration. Applies to the Caddy managed process
 * and upstream connections.
 */
export interface NetworkConfig {
  readonly tenant_id: ID;
  /** Daemon listen addresses — tuples of address + port (e.g. ':443'). Read-only in stage 1. */
  listen_addresses: string[];
  /** Caddy JSON config overrides. Free-form JSON string (not parsed at stage 1). */
  caddy_config_overrides: string;
  http3_enabled: boolean;
  /** Default upstream timeouts in seconds. */
  upstream_timeouts: {
    connect: number; // 1..300
    read: number; // 1..3600
    write: number; // 1..3600
    idle: number; // 1..3600
  };
  readonly updated_at: string;
}

/**
 * Certificate Authority. `internal` is the Rioku-managed CA seeded by default;
 * `external` represents an operator-imported CA (e.g., a Let's Encrypt chain
 * or corporate issuer).
 */
export interface CertAuthority {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  kind: 'internal' | 'external';
  subject: string; // e.g. "CN=Rioku Internal Root CA"
  issuer: string; // same as subject for self-signed
  /** Not-before / not-after in ISO-8601 */
  not_before: string;
  not_after: string;
  /** Fake-looking SHA-256 hex (64 chars) — no real crypto in mock */
  fingerprint_sha256: string;
  /** For external CAs, the PEM blob the operator pasted. Empty for internal. */
  certificate_pem: string;
  readonly created_at: string;
}

/**
 * Certificate enrollment. Represents a pending, issued, or revoked cert
 * request managed by Rioku's PKI.
 */
export interface CertEnrollment {
  readonly id: ID;
  readonly tenant_id: ID;
  readonly ca_id: ID; // FK to CertAuthority
  subject: string; // CN/SAN summary
  dns_sans: string[];
  state: 'pending' | 'issued' | 'revoked';
  /** ISO-8601 timestamps; null when state hasn't reached that point */
  requested_at: string;
  issued_at?: string;
  revoked_at?: string;
  revocation_reason?: string;
  /** Fingerprint populated once issued */
  fingerprint_sha256?: string;
}

/**
 * Admin-side audit entry — extends AuditEntry with hash-chain fields.
 * Written to the separate adminAudit log in the mock store.
 */
export interface AdminAuditEntry extends AuditEntry {
  /** kind discriminator — always 'admin' */
  kind: 'admin';
  /** SHA-256 (hex) of the previous entry's content, or empty string for the first */
  prev_hash: string;
  /** SHA-256 (hex) of this entry's content (excluding `hash` itself) */
  hash: string;
}

// ─── Sites ────────────────────────────────────────────────────────────────────

export interface Site {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  domain: string;
  tls_mode: 'auto' | 'manual' | 'off';
  enabled: boolean;
  readonly created_at: string;
  // Plan 2 additions:
  upstream_service_id?: ID;
  tls_manual_cert?: { cert_pem_preview: string; key_pem_preview: string; expires_at?: string };
  basic_auth_enabled: boolean;
  rate_limit_preset: 'none' | 'lenient' | 'standard' | 'strict';
  redirect_rules: { from: string; to: string; status: 301 | 302 | 307 | 308 }[];
  readonly updated_at: string;
}

// ─── Dashboards + widgets ─────────────────────────────────────────────────────

export interface WidgetWizardState {
  dimensions: string[];
  measures: {
    field: string;
    aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
    alias?: string;
  }[];
  filters: {
    field: string;
    op: '==' | '!=' | '>' | '<' | 'in' | 'contains';
    value: unknown;
  }[];
  group_by?: string;
  order_by?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

export interface Widget {
  readonly id: ID;
  readonly dashboard_id: ID;
  /** Widget type id — built-in (single-stat, sparkline, …) or plugin-registered. */
  kind: string;
  title: string;
  config: Record<string, unknown>;
  /**
   * Legacy grid position. Canonical layout source is `Dashboard.layout`.
   * TODO(Plan 4c): remove once all builder paths migrate to `Dashboard.layout`.
   */
  position: { x: number; y: number; w: number; h: number };
  // New in Plan 4:
  /**
   * Data-source kind — one of the 6 built-in sources or a plugin-declared id.
   *
   * Builtin values: `'audit' | 'services' | 'routes' | 'traces' | 'notifications' | 'mock'`.
   * Plugin adapters may register arbitrary string ids.
   */
  data_source: string;
  /** For advanced mode: raw query text. Empty = wizard-built. */
  raw_query: string;
  /** Wizard state — preserved when flipping to advanced (one-way for non-trivial widgets). */
  wizard_state?: WidgetWizardState;
  /** True when widget has been flipped to advanced and wizard view is disabled. */
  locked_advanced: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface DashboardVariable {
  name: string;
  kind: 'text' | 'enum' | 'interval';
  default: string;
  /** Populated when kind === 'enum'. */
  options?: string[];
}

export interface Dashboard {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  default: boolean;
  widget_ids: ID[];
  // New in Plan 4:
  description?: string;
  /** null = tenant-shared. */
  owner_user_id: ID | null;
  mode: 'metabase' | 'grafana';
  /** Scope: 'personal' = owner-only, 'tenant' = all tenant members, 'shared' = role-restricted. */
  scope: 'personal' | 'tenant' | 'shared';
  /** Roles allowed to view when scope === 'shared'. */
  shared_role_ids: ID[];
  /** Grid layout (w,h,x,y per widget) keyed by widget id. Canonical layout source. */
  layout: Record<ID, { x: number; y: number; w: number; h: number }>;
  /** Grafana-mode variables (only relevant when mode === 'grafana'). */
  variables: DashboardVariable[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface DashboardVersion {
  readonly id: ID;
  readonly dashboard_id: ID;
  readonly version: number;
  readonly created_at: string;
  readonly created_by: ID;
  description?: string;
  snapshot: {
    dashboard: Omit<Dashboard, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>;
    widgets: Omit<Widget, 'dashboard_id' | 'created_at' | 'updated_at'>[];
  };
}

// ─── Notifications ────────────────────────────────────────────────────────────

/**
 * Notification inbox entry — spec §11.
 *
 * Categories:
 *   - 'system'        — infrastructure / health / policy notifications
 *   - 'security'      — session revokes, MFA, suspicious activity
 *   - 'audit'         — destructive actions, retention changes
 *   - 'plugin:<slug>' — emitted by a plugin via `host.notify`; `<slug>` must match
 *                       `^[a-z][a-z0-9-]*$`
 *
 * `tenant_id: null` denotes a cross-tenant / super-admin notification.
 * `read_at` and `archived_at` are ISO timestamps or null (unread / not-archived).
 *
 * Plan 7 extended this shape — earlier Plan 1 callers used `read: boolean`,
 * `created_at`, and `action_url`. Those fields are preserved (as optional /
 * derived) so legacy widget adapters keep compiling.
 */
export interface NotificationItem {
  readonly id: ID;
  /** null = cross-tenant / super-admin broadcast. */
  readonly tenant_id: ID | null;
  readonly user_id: ID;
  category: string;
  severity: 'info' | 'warn' | 'error' | 'success';
  title: string;
  body: string;
  /** Optional "click here" action rendered as a button. */
  action?: { label: string; href: string };
  /** ISO timestamp or null if still unread. */
  read_at: string | null;
  /** ISO timestamp or null if not yet archived. */
  archived_at: string | null;
  /** ISO timestamp — when the notification was emitted. */
  readonly at: string;
  // ── Legacy Plan 1 fields (kept for back-compat with widget data-sources) ──
  /** Legacy boolean mirror of `read_at !== null`. */
  read: boolean;
  /** Legacy alias of `at`. */
  readonly created_at: string;
  /** Legacy flat href — prefer `action.href`. */
  action_url?: string;
}

export interface NotificationChannel {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  kind: 'email' | 'slack' | 'webhook' | 'pagerduty' | 'teams' | 'sms';
  /** Per-kind config — validated by the kind-specific Zod schema. */
  config: Record<string, unknown>;
  enabled: boolean;
  readonly created_at: string;
}

export interface NotificationRoutingRule {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  /** Category + severity glob (e.g. `'security.*'`, `'audit.destructive'`). */
  event_filter: string;
  channel_ids: ID[];
  enabled: boolean;
  /** Evaluation order — lower runs first. Dense ordering is maintained on reorder. */
  order_hint: number;
  readonly created_at: string;
}

export interface NotificationDeliveryLogEntry {
  readonly id: ID;
  readonly tenant_id: ID;
  readonly channel_id: ID;
  readonly notification_id: ID;
  status: 'delivered' | 'retrying' | 'failed' | 'pending';
  attempts: number;
  error_message?: string;
  readonly first_attempted_at: string;
  last_attempted_at: string;
  // ── Legacy Plan 1 fields (back-compat) ─────────────────────────────────
  /** Legacy alias of `last_attempted_at`. */
  attempted_at: string;
  /** Legacy alias of `error_message`. */
  error?: string;
}

/**
 * Tenant-scoped notification configuration.
 * Controls master on/off, opt-in mode, plugin category registration,
 * channel priority, and retry behaviour.
 */
export interface TenantNotificationConfig {
  readonly tenant_id: ID;
  /** Master kill switch — when false, no notifications are dispatched. */
  enabled: boolean;
  /** Whether users must opt-in per category (true) or opt-out (false). */
  opt_in_mode: 'opt-in' | 'opt-out';
  /** Allow installed plugins to register their own notification categories. */
  plugins_can_register_categories: boolean;
  /**
   * Ordered list of channel IDs that define delivery priority when multiple
   * routing rules match the same event. First channel in the list is tried first.
   */
  default_channel_priority: ID[];
  /** Maximum number of delivery retries before a log entry is marked `failed`. 0–10. */
  max_retries: number;
  /** Base back-off interval between retries, in seconds. 1–3600. */
  retry_backoff_seconds: number;
  readonly updated_at: string;
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export interface Plugin {
  readonly id: ID;
  /** null = global/super-admin scope */
  tenant_scope: ID | null;
  slug: string;
  display_name: string;
  version: string;
  enabled: boolean;
  parts: ('daemon' | 'caddy' | 'admin')[];
  declared_permissions: string[];
  manifest: unknown;
  has_errors: boolean;
  // New in Plan 6:
  /** Build/swap state. 'stable' = latest published; 'building' = install in progress; 'failed' = last install failed. */
  build_state: 'stable' | 'building' | 'failed';
  /** Captured stdout/stderr for failed builds. */
  last_build_log?: string;
  /** FK to PluginSigner.id — who signed this plugin. Optional (unsigned / dev-mode). */
  signer_id?: ID;
  /** Stage-1 mock — cosign verification outcome. */
  cosign_verified: boolean;
  /** Opaque SBOM URI (e.g. oci://..., https://...). */
  sbom_uri?: string;
}

/**
 * PluginSigner — identity of a party authorised to sign plugins.
 *
 * Plan 6 stage-1 mock surface. In stage 2+ this maps to the cosign/TUF root
 * allow-list enforced by the daemon.
 */
export interface PluginSigner {
  readonly id: ID;
  /** null = global (super-admin-only); otherwise tenant-scoped. */
  tenant_scope: ID | null;
  name: string;
  /** SHA-256 hex fingerprint (64 lowercase hex chars). */
  fingerprint: string;
  /** 'verified' = cosign-valid, 'revoked' = explicitly denied, 'pending' = awaiting review. */
  status: 'verified' | 'revoked' | 'pending';
  description?: string;
  readonly created_at: string;
}

export interface MarketplaceListing {
  readonly id: ID;
  slug: string;
  display_name: string;
  author: string;
  description: string;
  version: string;
  tags: string[];
  installs: number;
  verified: boolean;
}

// ─── AI ───────────────────────────────────────────────────────────────────────

export interface AiProvider {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  kind: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom';
  base_url: string;
  enabled: boolean;
  // New in Plan 3:
  description?: string;
  /** Credential reference — stores prefix-only; real value never persisted after create. */
  credential_ref: { prefix: string; created_at: string };
  /** Published model aliases backed by this provider. */
  models: AiProviderModel[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AiProviderModel {
  /** Canonical upstream model id, e.g. "gpt-4o" or "claude-3-7-sonnet". */
  upstream_id: string;
  /** User-friendly alias surfaced in agent config. */
  alias: string;
  /** Per-model rate/quota. Null = inherit provider default. */
  rate_limit_rpm: number | null;
  daily_quota_tokens: number | null;
  enabled: boolean;
}

export interface AiAgent {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  provider_id: ID;
  /** Model alias from the provider's `models[].alias`. */
  model: string;
  system_prompt: string;
  tool_ids: ID[];
  enabled: boolean;
  // New in Plan 3:
  description?: string;
  /** Scoped credential reference; agent can hold its own API key distinct from provider. */
  scoped_credential_ref?: { prefix: string; created_at: string };
  /** RBAC role bindings — which roles are allowed to invoke this agent. */
  role_ids: ID[];
  /** Guardrails. */
  max_tokens_per_request: number;
  temperature: number;
  stop_sequences: string[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AiTool {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  description: string;
  /** JSON schema for tool input (JSON-schema draft-07). */
  schema: Record<string, unknown>;
  mcp_server_id?: ID;
  // New in Plan 3:
  /** Handler kind — native = daemon-built-in, mcp = proxied via MCP server, http = call an external HTTP endpoint. */
  kind: 'native' | 'mcp' | 'http';
  /** Populated when kind === 'http'. */
  http_endpoint?: { url: string; method: 'GET' | 'POST'; auth_header?: string };
  /** Dangerous tools require explicit agent opt-in; flagged in the approval UI. */
  dangerous: boolean;
  enabled: boolean;
  readonly created_at: string;
}

export interface AiTrace {
  readonly id: ID;
  readonly tenant_id: ID;
  readonly agent_id: ID;
  readonly session_id?: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  status: 'success' | 'error' | 'timeout';
  readonly at: string;
  // New in Plan 3:
  /** Provider + model used — redundant with agent but captured at trace time for historical fidelity. */
  provider_id: ID;
  model: string;
  prompt_text: string;
  completion_text: string;
  tool_calls: AiTraceToolCall[];
  cost_usd: number;
  error_message?: string;
  /** User-facing request id (from gateway). */
  request_id: string;
}

export interface AiTraceToolCall {
  readonly tool_id: ID;
  readonly tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  latency_ms: number;
  status: 'success' | 'error' | 'timeout';
  error_message?: string;
}

export interface McpServer {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  url: string;
  auth_kind: 'none' | 'bearer' | 'api-key';
  enabled: boolean;
  // New in Plan 3:
  description?: string;
  /** Auth credential ref — stored prefix-only. */
  auth_credential_ref?: { prefix: string; created_at: string };
  /** Which agents are authorized to route tools through this server. Empty = all. */
  authorized_agent_ids: ID[];
  /** Last-seen health. */
  health: 'healthy' | 'degraded' | 'unreachable' | 'disabled';
  /** Tools exposed by this server (mock: populated from aiTools where mcp_server_id === id). */
  exposed_tool_count: number;
  readonly created_at: string;
  readonly last_seen_at?: string;
}

/**
 * Semantic rate-limit rule. Applies across agents/tools by matching request shape
 * (scope) against a cosine-similarity threshold vs a provided exemplar corpus.
 */
export interface AiSemanticRateLimit {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  description?: string;
  scope: 'tenant' | 'agent' | 'tool';
  /** Populated when scope === 'agent'. */
  agent_id?: ID;
  /** Populated when scope === 'tool'. */
  tool_id?: ID;
  /** Exemplar corpus — mock: array of short strings. */
  exemplars: string[];
  /** Cosine similarity threshold (0.0–1.0). */
  similarity_threshold: number;
  /** Rolling window. */
  window_seconds: number;
  max_matches: number;
  /** Action on limit hit. */
  action: 'block' | 'degrade' | 'log';
  enabled: boolean;
  readonly created_at: string;
}

/**
 * Tool routing binding — controls which agent may invoke which tool, and under
 * what additional conditions (CEL expression, mirrors access-policy grammar).
 */
export interface AiToolBinding {
  readonly id: ID;
  readonly tenant_id: ID;
  agent_id: ID;
  tool_id: ID;
  /** Optional CEL condition — empty string = always allow. */
  condition: string;
  enabled: boolean;
  readonly created_at: string;
}

/**
 * TLS certificate. Represents an issued cert for a domain — either ACME-automated
 * or operator-uploaded manually.
 */
export interface TlsCertificate {
  readonly id: ID;
  readonly tenant_id: ID;
  domain: string; // e.g. "api.example.com"
  /** e.g. "Let's Encrypt", "ZeroSSL", "Self-signed", or "Manual" */
  issuer: string;
  source: 'acme' | 'manual';
  /** ISO-8601 */
  issued_at: string;
  expires_at: string;
  /** Only applies to acme source. Stage-1 toggle only. */
  auto_renew: boolean;
  /** Cert PEM (for manual uploads; empty for ACME-managed). */
  certificate_pem: string;
  /** Fake SHA-256 hex (64 chars) */
  fingerprint_sha256: string;
  readonly created_at: string;
}

/**
 * Per-tenant observability configuration. Covers metrics, logs, and traces.
 * Audit retention is stored separately in AuditRetentionConfig (Plan 5).
 */
export interface ObservabilityConfig {
  readonly tenant_id: ID;
  metrics: {
    /** Prometheus scrape endpoint path (e.g. '/metrics'). */
    scrape_endpoint: string;
    /** Scrape-side auth mode. */
    scrape_auth: 'none' | 'bearer' | 'mtls';
    /** Days of metric retention. */
    retention_days: number;
  };
  logs: {
    /** Log level per component (daemon / caddy / plugin). */
    levels: {
      daemon: LogLevel;
      caddy: LogLevel;
      plugin: LogLevel;
    };
    /** 'json' = structured, 'text' = plain. */
    format: 'json' | 'text';
    rotation: {
      max_size_mb: number; // 1..1024
      max_backups: number; // 0..100
      max_age_days: number; // 0..365 (0 = disabled)
      compress: boolean;
    };
  };
  traces: {
    retention_days: number; // 0..365 (0 = disabled)
    /** Sample rate 0.0 - 1.0; 1.0 = every trace. */
    sample_rate: number;
  };
  readonly updated_at: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ─── Integrations ─────────────────────────────────────────────────────────────

/**
 * External inbound webhook endpoint. Stage-1 placeholder — real handler
 * registration happens at stage 2+.
 */
export interface WebhookEndpoint {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  path: string; // e.g. "/webhooks/github-events"
  /** Stage-1 placeholder — static list in UI; not consulted at runtime. */
  expected_event_types: string[];
  secret: string; // fake random 32-char hex
  enabled: boolean;
  readonly created_at: string;
}

/**
 * Per-tenant ACME + TLS configuration.
 */
export interface TlsConfig {
  readonly tenant_id: ID;
  acme: {
    provider: 'lets-encrypt' | 'zerossl' | 'custom';
    /** Account email for ACME registration */
    email: string;
    /** For provider='custom', the ACME directory URL */
    directory_url?: string;
    /** When true, use DNS-01 challenge instead of HTTP-01 */
    dns_challenge: boolean;
  };
  /** Allowed TLS 1.2/1.3 cipher suites (openssl-style names). */
  allowed_ciphers: string[];
  readonly updated_at: string;
}

// ─── Cluster ──────────────────────────────────────────────────────────────────

/**
 * A single node participating in the Rioku cluster.
 * Stage-1 mock — real data flows from daemon gRPC ClusterService at stage 2.
 */
export interface ClusterNode {
  readonly id: ID;
  name: string; // e.g. "rioku-east-1"
  role: 'primary' | 'replica' | 'witness';
  status: 'healthy' | 'degraded' | 'unreachable' | 'joining' | 'leaving';
  address: string; // e.g. "10.0.1.23:7777"
  version: string; // e.g. "0.1.0"
  joined_at: string;
  last_heartbeat_at: string;
  metrics: {
    cpu_percent: number; // 0-100
    memory_percent: number; // 0-100
    requests_per_second: number;
    latency_p95_ms: number;
  };
}

/**
 * A short-lived enrollment token used to join a new node to the cluster.
 * Stage-1 mock — real token issuance happens at stage 2.
 */
export interface ClusterEnrollmentToken {
  readonly id: ID;
  token: string; // fake bearer token
  created_by: ID; // user_id
  expires_at: string;
  consumed_by_node_id?: ID; // set once a node consumes the token
  readonly created_at: string;
}
