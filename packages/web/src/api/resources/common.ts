// Owned by common (no single-plan owner) — shared primitives referenced by multiple features.

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

export interface Grant {
  permission: string;
  /** Optional CEL expression evaluated at request time */
  when?: string;
}

export interface Permission {
  readonly key: string;
  description: string;
  source: 'built-in' | 'plugin-manifest' | 'plugin-dynamic';
  default_roles?: string[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
