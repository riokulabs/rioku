/**
 * Auth E2E smoke tests — full authentication flow coverage.
 *
 * Covers: login, TOTP challenge, backup codes, forgot/reset password,
 * force-password-change guard, invite flow, bootstrap, and sign-out.
 *
 * The _unauth prefix is a TanStack Router layout identifier only — it does NOT
 * appear in the browser URL. Actual routes are /login, /totp, /totp-recovery,
 * /forgot-password, /reset-password/:token, /invite/:token, /bootstrap.
 *
 * Task 1e.98
 */
import { expect } from '@playwright/test';
import { test, getStoreState } from '../fixtures/auth';
import { expectNoA11yViolations } from '../axe';

// Minimal store-shape interfaces used inside page.evaluate() callbacks.
// These run in the browser context so we access window.__RIOKU_STORE directly.

interface WindowWithStore {
  __RIOKU_STORE?: {
    getState: () => MockStoreSnapshot;
    setState: (patch: Partial<MockStoreSnapshot>) => void;
  };
}

interface MockStoreSnapshot {
  currentUserId: string | null;
  currentTenantId: string | null;
  pendingAuthUserId: string | null;
  users: Record<string, MockUser>;
  tenants: Record<string, MockTenant>;
  memberships: Record<string, MockMembership>;
  roles: Record<string, { id: string }>;
  updateEntity: (kind: string, id: string, patch: Record<string, unknown>) => void;
  addEntity: (kind: string, entity: Record<string, unknown>) => void;
}

interface MockUser {
  id: string;
  email: string;
  backup_codes?: string[];
  force_password_change?: boolean;
}

interface MockTenant {
  id: string;
  slug: string;
  name?: string;
}

interface MockMembership {
  id: string;
  user_id: string;
  tenant_id: string;
  state: string;
  invite_token?: string;
  role_ids: string[];
}

// URL patterns — _unauth is layout-only, actual URLs omit it.
const loginUrl = /\/login/;
const totpUrl = /\/totp(?!-)/;
const totpRecoveryUrl = /\/totp-recovery/;
const resetPasswordUrl = /\/reset-password\//;
const forceResetUrl = /\/reset-password\/force-reset-/;

// ─── Test 1: unauthenticated redirect ────────────────────────────────────────

test('unauthenticated user is redirected from guarded route to login', async ({
  clearSessionPage: page,
}) => {
  // The settings route has `requirePermissions({ required: ['tenant:switch'] })`.
  // Without a session, it redirects to /login?return=... before rendering.
  await page.goto('/t/acme/settings');

  // Should land on login page.
  await expect(page).toHaveURL(loginUrl);

  // The return URL search param should encode the original path.
  await expect(page).toHaveURL(/return=/);

  // Login form should be visible.
  await expect(page.getByRole('heading', { name: /sign in to rioku/i })).toBeVisible();

  // A11y sweep on login page.
  await expectNoA11yViolations(page);
});

// ─── Test 2: login without TOTP ──────────────────────────────────────────────

test('login with valid email and password succeeds without TOTP when totp_enrolled=false', async ({
  clearSessionPage: page,
}) => {
  // Alice (userSeeds[1]) has i=1 → totp_enrolled = (1 === 0 || 1 % 3 === 0) = false.
  // So Alice does not require TOTP on login.
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /sign in to rioku/i })).toBeVisible();

  await page.getByTestId('email-input').fill('alice@acme.com');
  await page.getByTestId('password-input').fill('anypassword');
  await page.getByRole('button', { name: /sign in/i }).click();

  // Should redirect to tenant dashboard (not TOTP page).
  await expect(page).toHaveURL(/\/t\/[^/]+\/dashboard/);
  await expect(page).not.toHaveURL(totpUrl);
});

// ─── Test 3: login with TOTP-enrolled user routes through TOTP challenge ─────

test('login with TOTP-enrolled user routes through TOTP challenge', async ({
  clearSessionPage: page,
}) => {
  // Derrick (i=0) has totp_enrolled = true.
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /sign in to rioku/i })).toBeVisible();

  await page.getByTestId('email-input').fill('derrick@rioku.dev');
  await page.getByTestId('password-input').fill('anypassword');
  await page.getByRole('button', { name: /sign in/i }).click();

  // Should redirect to TOTP challenge.
  await expect(page).toHaveURL(totpUrl);
  await expect(page.getByRole('heading', { name: /two-factor authentication/i })).toBeVisible();

  // Stage-1: any 6-digit numeric code is accepted.
  // PinInput auto-submits when 6 characters are entered.
  const pinInputs = page.locator('[data-testid="totp-pin-input"] input');
  await pinInputs.first().click();
  await page.keyboard.type('123456');

  // Should redirect to dashboard after successful TOTP.
  await expect(page).toHaveURL(/\/t\/[^/]+\/dashboard/, { timeout: 8000 });
});

// ─── Test 4: TOTP challenge form blocks short/incomplete codes ────────────────

test('TOTP challenge form blocks submission when code is not exactly 6 digits', async ({
  clearSessionPage: page,
}) => {
  // Login as Derrick to get to TOTP page.
  await page.goto('/login');
  await page.getByTestId('email-input').fill('derrick@rioku.dev');
  await page.getByTestId('password-input').fill('anypassword');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(totpUrl);

  // The Verify button is disabled when less than 6 digits are entered.
  const verifyBtn = page.getByRole('button', { name: /verify/i });
  // Initially disabled (code = '').
  await expect(verifyBtn).toBeDisabled();

  // Type 5 digits — still disabled because PinInput auto-submits only on 6.
  const pinInputs = page.locator('[data-testid="totp-pin-input"] input');
  await pinInputs.first().click();
  await page.keyboard.type('12345');

  // Still disabled with 5 digits.
  await expect(verifyBtn).toBeDisabled();

  // Should not have navigated away.
  await expect(page).toHaveURL(totpUrl);
});

// ─── Test 5: backup code path signs user in and shows remaining count ─────────

test('backup code path signs user in and shows remaining count', async ({
  clearSessionPage: page,
}) => {
  // Step 1: Login as Derrick to reach TOTP challenge.
  await page.goto('/login');
  await page.getByTestId('email-input').fill('derrick@rioku.dev');
  await page.getByTestId('password-input').fill('anypassword');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(totpUrl);

  // Inject backup codes into Derrick's user record so verifyBackupCode has codes to check.
  const backupCode = await page.evaluate(() => {
    const store = (window as unknown as WindowWithStore).__RIOKU_STORE;
    if (!store) throw new Error('__RIOKU_STORE not found');
    const state = store.getState();
    const userId = state.pendingAuthUserId;
    if (!userId) throw new Error('No pendingAuthUserId');
    const user = state.users[userId];
    if (!user) throw new Error('User not found');
    if (!user.backup_codes || user.backup_codes.length === 0) {
      const codes = Array.from({ length: 10 }, (_, i) => `BACKUP${String(i).padStart(4, '0')}`);
      state.updateEntity('users', userId, { backup_codes: codes });
      const first = codes[0];
      if (!first) throw new Error('Generated codes array is empty');
      return first;
    }
    const firstCode = user.backup_codes[0];
    if (!firstCode) throw new Error('User backup_codes array is empty');
    return firstCode;
  });

  // Step 2: Click "Use a backup code instead".
  await page.getByTestId('use-backup-link').click();
  await expect(page).toHaveURL(totpRecoveryUrl);

  // Step 3: Enter the backup code.
  await page.getByTestId('backup-code-input').fill(backupCode);
  await page.getByRole('button', { name: /use backup code/i }).click();

  // Success notification should appear showing remaining count.
  await expect(page.getByTestId('recovery-success')).toBeVisible({ timeout: 5000 });
  // Use .first() to avoid strict-mode violation — both title and description
  // contain "backup code used" text (case insensitive).
  await expect(page.getByText(/backup code used/i).first()).toBeVisible();
  await expect(page.getByText(/9 code/i)).toBeVisible();

  // Should redirect to dashboard.
  await expect(page).toHaveURL(/\/t\/[^/]+\/dashboard/, { timeout: 5000 });
});

// ─── Test 6: forgot-password → stage-1 mock link → reset password ────────────

test('forgot-password flow shows stage-1 mock link and completes reset', async ({
  clearSessionPage: page,
}) => {
  // Navigate to forgot-password page.
  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: /forgot/i })).toBeVisible();

  // Fill email + submit.
  await page.getByTestId('forgot-email-input').fill('derrick@rioku.dev');
  await page.getByTestId('forgot-submit').click();

  // Stage-1 mock link block should appear.
  await expect(page.getByTestId('stage1-mock-link-block')).toBeVisible();

  // Click "Use this link" to navigate to the reset-password page.
  await page.getByTestId('use-reset-link').click();

  // Should be on reset-password page.
  await expect(page).toHaveURL(resetPasswordUrl);
  await expect(page.getByRole('heading', { name: /reset your password/i })).toBeVisible();

  // A11y sweep on reset-password page.
  await expectNoA11yViolations(page);

  // Wait for token validation to complete (shows form fields).
  await expect(page.getByTestId('new-password-input')).toBeVisible({ timeout: 5000 });

  // Fill new password + confirm.
  await page.getByTestId('new-password-input').fill('NewSecureP@ss1!');
  await page.getByTestId('confirm-password-input').fill('NewSecureP@ss1!');

  // Submit.
  await page.getByTestId('reset-submit').click();

  // Should redirect to dashboard or login (depends on whether currentTenantId is set
  // for a non-authenticated reset flow — stage-1 falls back to /login if no tenant).
  await expect(page).toHaveURL(/\/t\/[^/]+\/dashboard|\/login/, { timeout: 8000 });
});

// ─── Test 7: force-password-change redirects to reset page ───────────────────

test('force-password-change flag redirects logged-in user to reset-password page', async ({
  authedPage: page,
}) => {
  // authedPage starts at '/' which redirects to /tenants. Navigate to the
  // tenant dashboard first via client-side navigation (no full-page reload)
  // so the authedPage seed is not wiped by the addInitScript that runs on goto().
  await page.waitForURL(/\/tenants/, { timeout: 8000 });

  // Wait for seeding to settle, then verify we're authenticated.
  const state = await getStoreState(page);
  const userId = state.currentUserId as string;
  expect(userId).toBeTruthy();

  // Navigate to tenant dashboard via client-side navigation using the history API.
  // This avoids a full page reload which would trigger addInitScript (localStorage.clear())
  // and re-seed, resetting force_password_change to false.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/t/acme/dashboard');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  });
  // Give TanStack Router time to pick up the pushState.
  await page.waitForURL(/\/t\/acme\/dashboard/, { timeout: 5000 });

  // Set force_password_change = true on the current user via the store.
  await page.evaluate((uid) => {
    const store = (window as unknown as WindowWithStore).__RIOKU_STORE;
    if (!store) throw new Error('__RIOKU_STORE not found');
    store.getState().updateEntity('users', uid, { force_password_change: true });
  }, userId);

  // The ForcePasswordChangeGuard (useEffect in __root.tsx) should detect the flag
  // change and navigate to /reset-password/force-reset-<userId>.
  await expect(page).toHaveURL(forceResetUrl, { timeout: 8000 });
});

// ─── Test 8: invite token flow creates active membership ─────────────────────

test('invite token flow creates active membership and redirects to dashboard', async ({
  clearSessionPage: page,
}) => {
  // Inject a pending membership for Eve (beta user) joining acme.
  const ids = await page.evaluate(() => {
    const store = (window as unknown as WindowWithStore).__RIOKU_STORE;
    if (!store) throw new Error('__RIOKU_STORE not found');
    const state = store.getState();

    const userEntries = Object.values(state.users);
    const eveUser = userEntries.find((u) => u.email === 'eve@beta.io');
    const tenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    const roleId = Object.keys(state.roles)[0] ?? 'viewer-role';

    if (!eveUser || !tenant) throw new Error('Cannot find Eve or acme tenant in seed');

    const token = `invite-e2e-${String(Date.now())}`;
    const membershipId = `e2e-invite-mbr-${String(Date.now())}`;

    state.addEntity('memberships', {
      id: membershipId,
      tenant_id: tenant.id,
      user_id: eveUser.id,
      role_ids: [roleId],
      state: 'pending',
      invite_token: token,
      invite_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      invited_at: new Date().toISOString(),
    });

    return { token, tenantSlug: tenant.slug };
  });

  // Navigate to the invite page.
  await page.goto(`/invite/${ids.token}`);

  // Invite context should be visible.
  await expect(page.getByTestId('invite-context')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/acme corp/i)).toBeVisible();

  // Fill password + confirm.
  await page.getByTestId('invite-password-input').fill('InviteP@ss1!');
  await page.getByTestId('invite-confirm-input').fill('InviteP@ss1!');
  await page.getByTestId('invite-next').click();

  // TOTP enrollment: step 1 — click "I've added the account — next"
  await expect(page.getByTestId('enroll-block-next-to-codes')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('enroll-block-next-to-codes').click();

  // Step 2: backup codes — click "I've saved my codes — next"
  await expect(page.getByTestId('enroll-block-next-to-confirm')).toBeVisible();
  await page.getByTestId('enroll-block-next-to-confirm').click();

  // Step 3: confirm with any 6-digit code (stage-1 accepts any).
  await expect(page.getByTestId('enroll-block-pin-input')).toBeVisible();
  const enrollPinInputs = page.locator('[data-testid="enroll-block-pin-input"] input');
  await enrollPinInputs.first().click();
  await page.keyboard.type('654321');

  // Should redirect to the new tenant's dashboard.
  await expect(page).toHaveURL(/\/t\/[^/]+\/dashboard/, { timeout: 10000 });

  // Verify the membership is now active.
  const isActive = await page.evaluate((token) => {
    const store = (window as unknown as WindowWithStore).__RIOKU_STORE;
    if (!store) throw new Error('__RIOKU_STORE not found');
    const state = store.getState();
    const mbr = Object.values(state.memberships).find((m) => m.invite_token === token);
    return mbr?.state === 'active';
  }, ids.token);

  expect(isActive).toBe(true);
});

// ─── Test 9: bootstrap first-run creates root user + tenant ──────────────────

test('bootstrap first-run creates root user and tenant', async ({
  clearSessionPage: page,
}) => {
  // Clear all users/tenants/memberships from the store AND from persisted
  // localStorage so that when page.goto('/bootstrap') triggers addInitScript
  // (which patches localStorage) and the page reloads, the store re-hydrates
  // with empty users and the bootstrap beforeLoad guard allows entry.
  await page.evaluate(() => {
    const store = (window as unknown as WindowWithStore).__RIOKU_STORE;
    if (!store) throw new Error('__RIOKU_STORE not found');
    store.setState({
      users: {},
      tenants: {},
      memberships: {},
      currentUserId: null,
      currentTenantId: null,
    });

    // Also patch localStorage directly so the page reload finds empty data.
    const raw = localStorage.getItem('rioku-mock-store');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
        if (parsed.state) {
          parsed.state.users = {};
          parsed.state.tenants = {};
          parsed.state.memberships = {};
          parsed.state.currentUserId = null;
          parsed.state.currentTenantId = null;
          parsed.state.pendingAuthUserId = null;
          localStorage.setItem('rioku-mock-store', JSON.stringify(parsed));
        }
      } catch {
        // Ignore.
      }
    }
  });

  // Navigate to bootstrap.
  await page.goto('/bootstrap');

  // The beforeLoad guard checks users.length; with empty users it should render.
  // Wait up to 10s since the dev server may take time to hydrate the page.
  await expect(page.getByRole('heading', { name: /welcome to rioku/i })).toBeVisible({
    timeout: 10000,
  });

  // Fill the bootstrap form.
  await page.getByTestId('bootstrap-tenant-name').fill('Test Corp');
  await page.getByTestId('bootstrap-tenant-slug').fill('test-corp');
  await page.getByTestId('bootstrap-name').fill('Root User');
  await page.getByTestId('bootstrap-email').fill('root@test.example');
  await page.getByTestId('bootstrap-password').fill('B00tstr@pP@ss1!');
  await page.getByTestId('bootstrap-confirm').fill('B00tstr@pP@ss1!');

  // main.tsx auto-seeds when users = 0 (async). By the time we submit, the seed
  // may have run and added users, making bootstrap() fail with "users already exist".
  // Re-clear users right before clicking submit to guarantee bootstrap() finds none.
  // IMPORTANT: we do NOT touch currentUserId/currentTenantId here to avoid triggering
  // the auth-bootstrap subscription (non-null → null transition = redirect to /login).
  // The bootstrap() API function doesn't check currentUserId — it only checks users.
  await page.evaluate(() => {
    const store = (window as unknown as WindowWithStore).__RIOKU_STORE;
    if (!store) throw new Error('__RIOKU_STORE not found');
    const state = store.getState();
    // Wipe entity collections without touching the session state.
    if (Object.keys(state.users).length > 0) {
      // Bypass auth-bootstrap by directly patching without going through setState
      // for session fields. Only wipe the entity maps.
      store.setState({ users: {}, tenants: {}, memberships: {} });
    }
  });

  await page.getByTestId('bootstrap-submit').click();

  // Should advance to the TOTP enrollment step.
  await expect(page.getByTestId('bootstrap-setup-complete')).toBeVisible({ timeout: 5000 });

  // TOTP enrollment: secret → backup codes → confirm.
  await expect(page.getByTestId('enroll-block-next-to-codes')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('enroll-block-next-to-codes').click();

  await expect(page.getByTestId('enroll-block-next-to-confirm')).toBeVisible();
  await page.getByTestId('enroll-block-next-to-confirm').click();

  await expect(page.getByTestId('enroll-block-pin-input')).toBeVisible();
  const enrollPinInputs = page.locator('[data-testid="enroll-block-pin-input"] input');
  await enrollPinInputs.first().click();
  await page.keyboard.type('789012');

  // Should redirect to the new tenant's dashboard.
  await expect(page).toHaveURL(/\/t\/test-corp\/dashboard/, { timeout: 10000 });
});

// ─── Test 10: signed-in user can sign out ────────────────────────────────────

test('signed-in user can sign out via sidebar', async ({ authedPage: page }) => {
  // Navigate to the dashboard (authedPage has Derrick pre-seeded).
  // Plan 4b changed the route to render the tenant's default dashboard inline
  // (e.g. acme → "Overview"), or a StockDashboard fallback. Assert on a stable
  // sidebar element instead of the page heading, which is now dashboard-name
  // dependent.
  await page.goto('/t/acme/dashboard');
  await expect(page.getByRole('link', { name: /^dashboard$/i })).toBeVisible();

  // A11y sweep on dashboard post-login.
  await expectNoA11yViolations(page);

  // Open the user menu in the sidebar footer (click the element containing "Derrick").
  const userMenuTarget = page
    .locator('[role="button"]')
    .filter({ hasText: /Derrick/i })
    .first();
  await userMenuTarget.click();

  // Click "Sign out" item.
  await page.getByTestId('sign-out-btn').click();

  // auth-bootstrap subscription triggers handleAuthFailure → redirect to /login.
  await expect(page).toHaveURL(loginUrl, { timeout: 8000 });

  // Verify store shows no current user.
  const userId = await page.evaluate(() => {
    const store = (window as unknown as WindowWithStore).__RIOKU_STORE;
    if (!store) return 'NO_STORE';
    return store.getState().currentUserId;
  });
  expect(userId).toBeNull();
});

// ─── Test 11: no telemetry during auth flow ───────────────────────────────────

test('no telemetry during auth flow — login through TOTP to dashboard', async ({
  clearSessionPage: page,
}) => {
  const external: string[] = [];

  // Collect any external requests throughout the test.
  page.on('request', (req) => {
    const url = req.url();
    if (
      !url.startsWith('http://localhost:5173') &&
      !url.startsWith('ws://localhost:5173') &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:')
    ) {
      external.push(url);
    }
  });

  // Walk through: login → TOTP → dashboard.
  await page.goto('/login');
  await page.getByTestId('email-input').fill('derrick@rioku.dev');
  await page.getByTestId('password-input').fill('anypassword');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(totpUrl);

  const pinInputs = page.locator('[data-testid="totp-pin-input"] input');
  await pinInputs.first().click();
  await page.keyboard.type('246810');

  await expect(page).toHaveURL(/\/t\/[^/]+\/dashboard/, { timeout: 8000 });
  await page.waitForLoadState('networkidle');

  expect(
    external,
    `Telemetry commitment violated during auth flow. External requests:\n${external.join('\n')}`,
  ).toEqual([]);
});
