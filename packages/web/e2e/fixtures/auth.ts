/**
 * Reusable Playwright auth fixtures.
 *
 * Two fixtures:
 *  - authedPage   — page with default seeded state (Derrick pre-logged-in).
 *  - clearSessionPage — page with localStorage cleared so the mock store
 *    re-seeds but currentUserId is null (unauthenticated).
 *
 * Usage:
 *   import { test } from '../fixtures/auth';
 *   test('...', async ({ authedPage }) => { ... });
 */
import { test as base, expect, type Page } from '@playwright/test';

// Type for the exposed window store — minimal interface for E2E access.
interface RiokuWindowStore {
  getState: () => Record<string, unknown>;
  setState: (patch: Record<string, unknown>) => void;
  subscribe: (listener: () => void) => () => void;
}

function getWindowStore(w: Window): RiokuWindowStore {
  const store = (w as unknown as { __RIOKU_STORE?: RiokuWindowStore }).__RIOKU_STORE;
  if (!store) throw new Error('__RIOKU_STORE not found on window — check main.tsx DEV guard');
  return store;
}

/** Helper: read a snapshot of the mock store state. */
export async function getStoreState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const store = (
      window as unknown as { __RIOKU_STORE?: { getState: () => Record<string, unknown> } }
    ).__RIOKU_STORE;
    if (!store) throw new Error('__RIOKU_STORE not found');
    return store.getState();
  });
}

export interface AuthFixtures {
  /** Page with the default seeded store (Derrick is logged in). */
  authedPage: Page;
  /** Page with a cleared session (currentUserId = null, seed data intact). */
  clearSessionPage: Page;
}

export const test = base.extend<AuthFixtures>({
  /**
   * authedPage — uses the default seeded mock state (Derrick is logged in).
   * Clears localStorage before the first page load so each test starts from
   * a fresh seed. The seed always ends with `currentUserId = derrickId`.
   * NOTE: because addInitScript runs on every navigation, every page.goto()
   * in this test will clear localStorage and re-seed. This is intentional for
   * authedPage — the seed always re-establishes Derrick's session.
   */
  authedPage: async ({ page, context }, applyFixture) => {
    await context.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto('/');
    // Wait for the store to be seeded (currentUserId becomes non-null).
    await page.waitForFunction(
      () => {
        const store = (
          window as unknown as {
            __RIOKU_STORE?: { getState: () => { currentUserId: string | null } };
          }
        ).__RIOKU_STORE;
        if (!store) return false;
        return store.getState().currentUserId !== null;
      },
      null,
      { timeout: 10000 },
    );
    await applyFixture(page);
  },

  /**
   * clearSessionPage — seed data is intact but currentUserId is forced to null.
   *
   * Strategy: install an addInitScript that runs on every navigation. Before the app
   * reads localStorage, it removes the session from the persisted state.
   * The seed only runs when users are empty (first ever navigation). After that,
   * the patched localStorage keeps users seeded but currentUserId = null.
   *
   * The seed does set currentUserId in memory at the end of seedStore(). We must
   * clear it again after the first navigation AND patch localStorage before any
   * subsequent page.goto() calls re-hydrate the persisted state.
   *
   * We use window.__RIOKU_STORE_CLEAR_SESSION = true as a handshake signal so the
   * app (via main.tsx) can skip setting currentUserId during seeding in E2E mode.
   * This avoids a race condition between seed and our in-memory clear.
   */
  clearSessionPage: async ({ page, context }, applyFixture) => {
    // Install init script: runs before EVERY navigation.
    // (1) Patches persisted localStorage to null out the session.
    // (2) Sets a sentinel so the app can detect "E2E clear-session mode".
    await context.addInitScript(() => {
      // Sentinel: tells main.tsx not to persist currentUserId from seed.
      (window as unknown as Record<string, unknown>).__RIOKU_CLEAR_SESSION = true;

      // Patch persisted state if it exists (subsequent navigations).
      // Only null out currentUserId/currentTenantId (the "logged in" state).
      // Do NOT null out pendingAuthUserId — tests that walk through TOTP flow
      // set it during the test and navigate to /totp-recovery via a full-page
      // anchor. If we wipe it here, the backup-code form loses the pending session.
      const raw = localStorage.getItem('rioku-mock-store');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
          if (parsed.state) {
            parsed.state.currentUserId = null;
            parsed.state.currentTenantId = null;
            localStorage.setItem('rioku-mock-store', JSON.stringify(parsed));
          }
        } catch {
          // Ignore parse errors.
        }
      }
    });

    // First navigation: store is empty → seed runs → sets currentUserId in memory.
    await page.goto('/');

    // Wait for seed to complete (users populated).
    await page.waitForFunction(
      () => {
        const store = (
          window as unknown as {
            __RIOKU_STORE?: { getState: () => { users: Record<string, unknown> } };
          }
        ).__RIOKU_STORE;
        if (!store) return false;
        return Object.keys(store.getState().users).length > 0;
      },
      null,
      { timeout: 10000 },
    );

    // Clear session in memory AND patch localStorage so subsequent navigations
    // (which re-run addInitScript) also start unauthenticated.
    await page.evaluate(() => {
      const store = (
        window as unknown as {
          __RIOKU_STORE?: { setState: (patch: Record<string, unknown>) => void };
        }
      ).__RIOKU_STORE;
      if (!store) throw new Error('__RIOKU_STORE not found');
      // Only clear the "logged in" session state — not pendingAuthUserId, which
      // is set mid-flow during tests (e.g. backup-code flow) and must survive
      // the full-page navigation to /totp-recovery.
      store.setState({ currentUserId: null, currentTenantId: null });

      // Update the persisted state immediately so the addInitScript on next navigation
      // finds the correct null session in localStorage.
      // We call setState above which triggers Zustand persist to write to localStorage
      // asynchronously. Force the write synchronously by patching directly.
      const raw = localStorage.getItem('rioku-mock-store');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
          if (parsed.state) {
            parsed.state.currentUserId = null;
            parsed.state.currentTenantId = null;
            localStorage.setItem('rioku-mock-store', JSON.stringify(parsed));
          }
        } catch {
          // Ignore.
        }
      }

      // Clear the auth-failure return URL from sessionStorage.
      // When store.setState({ currentUserId: null }) triggers the auth-bootstrap
      // subscription, handleAuthFailure() saves the current URL ('/') to
      // sessionStorage under 'rioku-return-to'. If not cleared here, that stale
      // return URL ('/'→ /tenants redirect) is consumed by consumeReturnUrl()
      // after the next successful login, overriding the intended destination.
      try {
        sessionStorage.removeItem('rioku-return-to');
      } catch {
        // Ignore if sessionStorage is unavailable.
      }
    });

    await applyFixture(page);
  },
});

// Re-export expect for convenience.
export { expect };
// Export the helper for internal use.
export { getWindowStore };
