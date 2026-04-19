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

export interface Widget {
  readonly id: ID;
  readonly dashboard_id: ID;
  kind: string;
  title: string;
  config: Record<string, unknown>;
  /** Grid position */
  position: { x: number; y: number; w: number; h: number };
}

export interface Dashboard {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  default: boolean;
  widget_ids: ID[];
  readonly created_at: string;
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
}

export interface AiAgent {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  provider_id: ID;
  model: string;
  system_prompt: string;
  tool_ids: ID[];
  enabled: boolean;
}

export interface AiTool {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  mcp_server_id?: ID;
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
}

export interface McpServer {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  url: string;
  auth_kind: 'none' | 'bearer' | 'api-key';
  enabled: boolean;
}
