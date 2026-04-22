/**
 * Auth feature — domain types.
 * spec §6 / Task 1e.83
 */

// ─── Credentials ──────────────────────────────────────────────────────────────

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface TotpVerifyPayload {
  code: string;
}

export interface BackupCodePayload {
  code: string;
}

// ─── TOTP enrollment ──────────────────────────────────────────────────────────

export interface TotpEnrollment {
  /** Base32-encoded TOTP secret (mock value for stage-1). */
  secret: string;
  /** otpauth:// URI string — display as text for user to copy into authenticator. */
  qr_url: string;
  /** 10 single-use backup codes. */
  backup_codes: string[];
}

// ─── Login result ─────────────────────────────────────────────────────────────

export type LoginResult =
  | { requires_totp: true; pending_user_id: string }
  | { requires_totp: false; user_id: string; tenant_id: string }
  | { error: string };

// ─── TOTP challenge result ────────────────────────────────────────────────────

export type TotpResult =
  | { ok: true; user_id: string; tenant_id: string }
  | { ok: false; error: string };

// ─── Backup code result ───────────────────────────────────────────────────────

export type BackupCodeResult =
  | { ok: true; user_id: string; tenant_id: string; remaining: number }
  | { ok: false; error: string };

// ─── Password reset ───────────────────────────────────────────────────────────

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetApply {
  token: string;
  newPassword: string;
}

/** Returned by requestPasswordReset — shows mock link in the UI only. */
export interface MockPasswordResetResult {
  mock_reset_link: string;
}

// ─── Invite accept ────────────────────────────────────────────────────────────

export interface InviteSetup {
  password: string;
  totp?: TotpVerifyPayload;
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

export interface BootstrapSetup {
  email: string;
  name: string;
  password: string;
  tenant_name: string;
  tenant_slug: string;
}

// ─── Auth state ───────────────────────────────────────────────────────────────

export interface AuthState {
  isAuthenticated: boolean;
  currentUserId: string | null;
  currentTenantId: string | null;
  pendingAuthUserId: string | null;
  isTotpPending: boolean;
}
