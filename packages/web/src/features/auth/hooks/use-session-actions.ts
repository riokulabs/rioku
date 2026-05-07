/**
 * useSessionActions — exposes login/logout actions and derives auth state
 * from the daemon's `/auth/me` endpoint plus the in-memory pending-creds slot
 * used during the TOTP step of login.
 *
 * Plan 01 — stage 2 wiring.
 */
import {
  login,
  logout,
  verifyTotp,
  verifyBackupCode,
  getPendingAuthUserId,
} from '../api';
import { useCurrentUser } from '../use-current-user';
import type { AuthState, LoginResult, TotpResult, BackupCodeResult } from '../types';

export interface SessionActions {
  authState: AuthState;
  loginAction(email: string, password: string): Promise<LoginResult>;
  verifyTotpAction(code: string): Promise<TotpResult>;
  verifyBackupCodeAction(code: string): Promise<BackupCodeResult>;
  logoutAction(): Promise<void>;
}

export function useSessionActions(): SessionActions {
  const { data: me } = useCurrentUser();
  const pendingAuthUserId = getPendingAuthUserId();

  const authState: AuthState = {
    isAuthenticated: me !== null && me !== undefined,
    currentUserId: me?.id ?? null,
    // Tenant context is per-route (`/t/{tenant}/...`); the daemon's `/auth/me`
    // does not lock the user to a single tenant, so this stays null at the
    // session-action layer. Components needing the active tenant slug read it
    // from the route params.
    currentTenantId: null,
    pendingAuthUserId,
    isTotpPending: pendingAuthUserId !== null,
  };

  return {
    authState,
    loginAction: login,
    verifyTotpAction: verifyTotp,
    verifyBackupCodeAction: verifyBackupCode,
    logoutAction: logout,
  };
}
