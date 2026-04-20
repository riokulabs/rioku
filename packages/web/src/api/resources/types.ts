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
  readonly created_at: string;
  updated_at: string;
}

export interface Tenant {
  readonly id: ID;
  slug: string;
  name: string;
  /** Hex accent color, e.g. '#22c55e' */
  accent: string;
  plan: 'community' | 'pro' | 'enterprise';
  readonly created_at: string;
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

export interface NotificationItem {
  readonly id: ID;
  readonly user_id: ID;
  category: string;
  title: string;
  body: string;
  read: boolean;
  readonly created_at: string;
  action_url?: string;
}

export interface NotificationChannel {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  kind: 'email' | 'slack' | 'webhook' | 'pagerduty' | 'teams' | 'sms';
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface NotificationRoutingRule {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  event_filter: string;
  channel_ids: ID[];
  enabled: boolean;
}

export interface NotificationDeliveryLogEntry {
  readonly id: ID;
  readonly channel_id: ID;
  readonly notification_id: ID;
  status: 'delivered' | 'failed' | 'pending';
  attempted_at: string;
  error?: string;
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
