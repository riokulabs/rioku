/**
 * Auth-failure interceptor.
 *
 * Handles 401 responses and session expiry:
 *  1. Saves the current URL to sessionStorage so the user returns after login.
 *  2. Clears the TanStack Query cache (stale data must not show post-logout).
 *  3. Navigates to /login?return=<encoded-url> via the injected router.
 *
 * The router instance is injected via `setAuthFailureRouter(router)` called
 * from main.tsx. This avoids an api/ → app/ ESLint boundary violation — api/
 * may not import from app/.
 *
 * Similarly the queryClient singleton from query-client.ts is used here because
 * query-client.ts lives in api/ (no boundary crossing needed).
 */

import { queryClient } from './query-client';

// ─── Router injection ─────────────────────────────────────────────────────────

/** Minimal router interface we need — avoids importing the full TanStack type. */
interface NavigateRouter {
  navigate(options: { to: string; replace?: boolean }): void | Promise<void>;
}

let _router: NavigateRouter | null = null;

/** Call from main.tsx after the router is created. */
export function setAuthFailureRouter(router: NavigateRouter): void {
  _router = router;
}

// ─── Core interceptor ─────────────────────────────────────────────────────────

const RETURN_KEY = 'rioku-return-to';

/**
 * Trigger the auth-failure flow.
 *
 * @param currentUrl - The full path+search the user was on (used as return URL).
 */
export function handleAuthFailure(currentUrl: string): void {
  // 1. Save return URL.
  try {
    sessionStorage.setItem(RETURN_KEY, currentUrl);
  } catch {
    // sessionStorage might be blocked by browser settings — ignore.
  }

  // 2. Clear query cache so stale data doesn't show after re-login.
  queryClient.clear();

  // 3. Navigate to login.
  const encoded = encodeURIComponent(currentUrl);
  void _router?.navigate({ to: `/login?return=${encoded}`, replace: true });
}

/** Read (and clear) the saved return-to URL after a successful login. */
export function consumeReturnUrl(): string | null {
  try {
    const url = sessionStorage.getItem(RETURN_KEY);
    if (url) sessionStorage.removeItem(RETURN_KEY);
    return url;
  } catch {
    return null;
  }
}
