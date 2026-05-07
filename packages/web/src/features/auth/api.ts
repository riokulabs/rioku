/**
 * Auth feature — real daemon-backed auth operations.
 *
 * All functions here issue HTTP requests to the daemon's `/api/v1/auth/*`
 * endpoints via `customFetch`. The daemon manages the HttpOnly session cookie;
 * the SPA never sees or stores tokens.
 *
 * Daemon endpoint mapping:
 *  - login                → POST /auth/login (re-called with totpCode for step 2)
 *  - logout               → POST /auth/logout
 *  - whoami / current     → GET  /auth/me
 *  - bootstrap status     → GET  /auth/bootstrap-status
 *  - bootstrap            → POST /auth/bootstrap
 *  - totp setup           → POST /auth/totp/setup
 *  - totp verify (enroll) → POST /auth/totp/verify  → returns backup codes
 *  - password reset req   → POST /auth/password-reset/request
 *  - password reset valid → GET  /auth/password-reset/validate?token=…
 *  - password reset apply → POST /auth/password-reset/apply
 *  - invite accept        → POST /auth/invite/accept
 *
 * Plan 01 — stage 2 wiring.
 */

import { customFetch } from '@/api/mutator';
import { ApiError, AuthFailureError, ValidationError } from '@/api/errors';
import type {
  LoginResult,
  TotpResult,
  TotpEnrollment,
  BackupCodeResult,
  MockPasswordResetResult,
  BootstrapSetup,
  InviteSetup,
} from './types';

// ─── Pending-credentials holder for two-step login ────────────────────────────
//
// When the daemon answers a /auth/login with `requiresTotp: true`, the SPA
// must re-submit the same credentials together with a `totpCode` to complete
// the login. The credentials are kept in memory only — never persisted to
// localStorage / sessionStorage / cookies — and cleared on every terminal
// outcome (success, hard error, logout).

interface PendingCredentials {
  username: string;
  password: string;
  userId: string;
}

let _pendingCredentials: PendingCredentials | null = null;

/** Test/utility access — exposed so tests can reset between runs. */
export function _resetPendingCredentialsForTests(): void {
  _pendingCredentials = null;
}

/** Read-only view used by other modules that need to know the pending userId. */
export function getPendingAuthUserId(): string | null {
  return _pendingCredentials?.userId ?? null;
}

// ─── Daemon response shapes ──────────────────────────────────────────────────

interface DaemonLoginUser {
  id: string;
  username: string;
  displayName?: string;
  forcePasswordChange: boolean;
}

interface DaemonLoginSession {
  id: string;
  expiresAt: string;
}

interface DaemonLoginResponse {
  user: DaemonLoginUser;
  session: DaemonLoginSession;
}

interface DaemonTotpRequiredResponse {
  requiresTotp: true;
  userId: string;
}

type DaemonLoginEither = DaemonLoginResponse | DaemonTotpRequiredResponse;

interface DaemonBootstrapResponse {
  tenantId: string;
  userId: string;
}

interface DaemonTotpSetupResponse {
  secret: string;
  qrUri: string;
}

interface DaemonTotpVerifyResponse {
  backupCodes: string[];
}

interface DaemonBootstrapStatus {
  required: boolean;
}

// ─── login (step 1) ──────────────────────────────────────────────────────────

/**
 * Submit username + password. Returns either:
 *  - a TOTP challenge (`requires_totp: true`) — the SPA must navigate to /totp
 *    and call `verifyTotp(code)` next.
 *  - a successful session (`requires_totp: false`) — daemon set the session
 *    cookie; subsequent requests are authenticated.
 *  - an error envelope.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  if (!password) {
    return { error: 'Password is required' };
  }

  // Reset any leftover pending state from a previous half-login.
  _pendingCredentials = null;

  try {
    const resp = await customFetch<DaemonLoginEither>({
      url: '/auth/login',
      method: 'POST',
      data: { username: email, password },
    });

    if ('requiresTotp' in resp) {
      _pendingCredentials = { username: email, password, userId: resp.userId };
      return { requires_totp: true, pending_user_id: resp.userId };
    }

    return {
      requires_totp: false,
      user_id: resp.user.id,
      // Daemon login does not return tenant context — the consumer fetches
      // /auth/me or /me/memberships separately. Empty string keeps the
      // `LoginResult` discriminator intact.
      tenant_id: '',
    };
  } catch (err) {
    return { error: errorMessage(err, 'Login failed') };
  }
}

// ─── logout ──────────────────────────────────────────────────────────────────

export async function logout(): Promise<void> {
  _pendingCredentials = null;
  try {
    await customFetch<unknown>({ url: '/auth/logout', method: 'POST' });
  } catch (err) {
    // 401 after logout is fine — we are intentionally unauthenticated now.
    if (err instanceof AuthFailureError) return;
    // Any other error is not surfaced — logout is best-effort. The session
    // cookie is gone server-side regardless.
  }
}

// ─── verifyTotp (login step 2) ───────────────────────────────────────────────

/**
 * Submit the 6-digit TOTP code following a `requires_totp` login result.
 *
 * Implementation: re-call `/auth/login` with the saved username/password plus
 * the new totp code. Daemon falls back to backup codes if the TOTP is invalid.
 */
export async function verifyTotp(code: string): Promise<TotpResult> {
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'Code must be exactly 6 digits' };
  }

  const pending = _pendingCredentials;
  if (!pending) {
    return { ok: false, error: 'No pending authentication session' };
  }

  try {
    const resp = await customFetch<DaemonLoginEither>({
      url: '/auth/login',
      method: 'POST',
      data: { username: pending.username, password: pending.password, totpCode: code },
    });

    if ('requiresTotp' in resp) {
      // Should not happen if the daemon accepted the code — defensive.
      return { ok: false, error: 'Authentication failed' };
    }

    _pendingCredentials = null;
    return { ok: true, user_id: resp.user.id, tenant_id: '' };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Invalid code — try again') };
  }
}

// ─── verifyBackupCode ────────────────────────────────────────────────────────

/**
 * Submit a backup code instead of a TOTP code. The daemon's `/auth/login`
 * handler tries backup codes when the TOTP code does not validate, so we
 * route through the same endpoint.
 */
export async function verifyBackupCode(code: string): Promise<BackupCodeResult> {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Backup code is required' };
  }

  const pending = _pendingCredentials;
  if (!pending) {
    return { ok: false, error: 'No pending authentication session' };
  }

  try {
    const resp = await customFetch<DaemonLoginEither>({
      url: '/auth/login',
      method: 'POST',
      data: { username: pending.username, password: pending.password, totpCode: trimmed },
    });

    if ('requiresTotp' in resp) {
      return { ok: false, error: 'Invalid backup code' };
    }

    _pendingCredentials = null;
    // The daemon does not currently return remaining-backup-code count; a
    // follow-up GET to /auth/me or a settings page surfaces it. We surface 0
    // here as a placeholder — the recovery UI shows the message but does not
    // depend on the precise number.
    return { ok: true, user_id: resp.user.id, tenant_id: '', remaining: 0 };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Invalid backup code') };
  }
}

// ─── enrollTotp (start setup; requires authenticated session) ────────────────

/**
 * Begin TOTP enrollment. Returns the shared secret + provisioning URI. The
 * daemon does not return backup codes at this stage — those are returned by
 * `confirmTotpEnrollment` after a valid 6-digit code is presented.
 */
export async function enrollTotp(_userId?: string): Promise<TotpEnrollment> {
  const resp = await customFetch<DaemonTotpSetupResponse>({
    url: '/auth/totp/setup',
    method: 'POST',
    data: {},
  });
  return {
    secret: resp.secret,
    qr_url: resp.qrUri,
    backup_codes: [], // populated by confirm step
  };
}

// ─── confirmTotpEnrollment ───────────────────────────────────────────────────

/**
 * Confirm TOTP enrollment. On success the daemon enables TOTP for the user
 * and returns a fresh set of backup codes (one-time view).
 */
export async function confirmTotpEnrollment(
  _userId: string,
  code: string,
): Promise<{ ok: boolean; error?: string; backup_codes?: string[] }> {
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'Code must be exactly 6 digits' };
  }

  try {
    const resp = await customFetch<DaemonTotpVerifyResponse>({
      url: '/auth/totp/verify',
      method: 'POST',
      data: { code },
    });
    return { ok: true, backup_codes: resp.backupCodes };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Invalid code') };
  }
}

// ─── bootstrap-status ────────────────────────────────────────────────────────

export async function fetchBootstrapStatus(): Promise<{ required: boolean }> {
  return customFetch<DaemonBootstrapStatus>({
    url: '/auth/bootstrap-status',
    method: 'GET',
  });
}

// ─── bootstrap ───────────────────────────────────────────────────────────────

export async function bootstrap(
  setup: BootstrapSetup,
): Promise<{ ok: boolean; user_id?: string; tenant_id?: string; error?: string }> {
  try {
    const resp = await customFetch<DaemonBootstrapResponse>({
      url: '/auth/bootstrap',
      method: 'POST',
      data: {
        email: setup.email,
        password: setup.password,
        tenantSlug: setup.tenant_slug,
        tenantName: setup.tenant_name,
      },
    });
    return { ok: true, user_id: resp.userId, tenant_id: resp.tenantId };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Bootstrap failed') };
  }
}

// ─── password reset ──────────────────────────────────────────────────────────

/**
 * Request a password-reset email. The daemon always returns 202 regardless of
 * whether the email matches a real user (anti-enumeration). The SPA mirrors
 * that by returning the same shape on every successful response.
 */
export async function requestPasswordReset(
  email: string,
): Promise<MockPasswordResetResult | { error: string }> {
  try {
    await customFetch<unknown>({
      url: '/auth/password-reset/request',
      method: 'POST',
      data: { email },
    });
    // The daemon emails the link directly; the SPA never sees it. The
    // `mock_reset_link` field is preserved for type-compatibility with the
    // stage-1 surface but is now an empty string — the UI renders the
    // "check your inbox" success state and does not display a clickable link.
    return { mock_reset_link: '' };
  } catch (err) {
    return { error: errorMessage(err, 'Could not request a reset') };
  }
}

export async function validateResetToken(
  token: string,
): Promise<{ ok: true; user_id: string; email: string } | { ok: false; error: string }> {
  try {
    interface ValidateResponse {
      valid: boolean;
    }
    const resp = await customFetch<ValidateResponse>({
      url: '/auth/password-reset/validate',
      method: 'GET',
      params: { token },
    });
    if (!resp.valid) {
      return { ok: false, error: 'Invalid or expired password reset link' };
    }
    // The daemon's validate response intentionally does not echo user info
    // (anti-enumeration); the SPA only needs to know the token is currently
    // usable so the form can render.
    return { ok: true, user_id: '', email: '' };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Invalid or expired password reset link') };
  }
}

export async function applyPasswordReset(
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await customFetch<unknown>({
      url: '/auth/password-reset/apply',
      method: 'POST',
      data: { token, password: newPassword },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Could not reset password') };
  }
}

// Force-reset is a daemon concern (admin sets `forcePasswordChange=true` on a
// user); the legacy mock helper is preserved as a no-op shim so existing
// callers compile, but the daemon-side flow surfaces the requirement via
// `/auth/me` and the SPA's `<ForcePasswordChangeGuard>` redirects to the
// settings change-password page rather than minting an in-band token.
export function generateForcePasswordToken(_userId: string): string {
  return '';
}

// ─── invite accept ───────────────────────────────────────────────────────────

export async function acceptInvite(
  token: string,
  setup: InviteSetup & { name?: string },
): Promise<{ ok: boolean; user_id?: string; tenant_id?: string; error?: string }> {
  try {
    interface AcceptResponse {
      userId: string;
      sessionId?: string;
      status?: string;
    }
    const resp = await customFetch<AcceptResponse>({
      url: '/auth/invite/accept',
      method: 'POST',
      data: {
        token,
        name: setup.name ?? '',
        password: setup.password,
      },
    });
    return { ok: true, user_id: resp.userId };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Could not accept invite') };
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ValidationError) {
    if (err.fields !== undefined) {
      const first = Object.values(err.fields).flat()[0];
      if (typeof first === 'string' && first.length > 0) return first;
    }
    return err.message || fallback;
  }
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
