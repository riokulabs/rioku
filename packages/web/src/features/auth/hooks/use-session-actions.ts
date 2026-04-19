/**
 * useSessionActions — exposes login/logout actions and session-derived state.
 *
 * Complements the read-only `useSession()` in src/hooks/use-session.ts.
 * Task 1e.83
 */
import { useMockStore } from '@/api/mock-store';
import { login, logout, verifyTotp, verifyBackupCode } from '../api';
import type { AuthState, LoginResult, TotpResult, BackupCodeResult } from '../types';

export interface SessionActions {
  /** Current auth state. */
  authState: AuthState;
  /** Step 1: email + password. */
  loginAction(email: string, password: string): Promise<LoginResult>;
  /** Step 2: TOTP code. */
  verifyTotpAction(code: string): Promise<TotpResult>;
  /** Alternative step 2: backup code. */
  verifyBackupCodeAction(code: string): Promise<BackupCodeResult>;
  /** Clear session. */
  logoutAction(): Promise<void>;
}

export function useSessionActions(): SessionActions {
  const currentUserId = useMockStore((s) => s.currentUserId);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  const pendingAuthUserId = useMockStore((s) => s.pendingAuthUserId);

  const authState: AuthState = {
    isAuthenticated: currentUserId !== null,
    currentUserId,
    currentTenantId,
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
