/**
 * End-to-end full-flow auth spec — drives the real sandbox daemon, not the
 * mock-store dev server. Requires:
 *   - rioku daemon running on http://localhost:7778 with a fresh (empty) DB
 *   - mailpit running on http://localhost:18025 (SMTP on :11025)
 *
 * Tagged `@isolated` because it mutates the daemon's store and the mailpit
 * inbox; it must not run alongside other tests that share the same sandbox.
 *
 * Plan 01 — stage 2 wiring.
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { totp } from './totp';

const DAEMON_BASE = process.env.RIOKU_DAEMON_BASE ?? 'http://localhost:7778';
const MAILPIT_BASE = process.env.MAILPIT_BASE ?? 'http://localhost:18025';

const ROOT_EMAIL = 'root@example.com';
const ROOT_PASSWORD = 'TestRoot1234!';
const NEW_PASSWORD = 'BrandNewPass456!';

test.use({ baseURL: DAEMON_BASE });

test.describe('@isolated full auth flow', () => {
  test('bootstrap → login → TOTP enroll → logout → password reset', async ({ page, context }) => {
    // ── 1. Visit / — the SPA's root guard sees bootstrap-required ─────────
    await page.goto('/');
    await expect(page).toHaveURL(/\/bootstrap$/);

    // ── 2. Submit the bootstrap form ──────────────────────────────────────
    await page.getByTestId('bootstrap-tenant-name').fill('Main Org');
    await page.getByTestId('bootstrap-tenant-slug').fill('main');
    await page.getByTestId('bootstrap-name').fill('Root User');
    await page.getByTestId('bootstrap-email').fill(ROOT_EMAIL);
    await page.getByTestId('bootstrap-password').fill(ROOT_PASSWORD);
    await page.getByTestId('bootstrap-confirm').fill(ROOT_PASSWORD);
    await page.getByTestId('bootstrap-submit').click();

    // After bootstrap, the SPA navigates to /login.
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });

    // ── 3. Sign in (no TOTP yet, so this is a single-step login) ──────────
    await page.getByTestId('email-input').fill('root');
    await page.getByTestId('password-input').fill(ROOT_PASSWORD);
    await page.getByTestId('login-submit').click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });

    // ── 4. Enroll TOTP via the daemon API directly using the cookie set
    //      by the login above (the SPA does not yet ship the post-login
    //      enrollment route on its top-level shell, so we drive the API to
    //      verify the daemon-side enrollment flow). ─────────────────────────
    const apiCtx = await pwRequest.newContext({
      baseURL: DAEMON_BASE,
      storageState: await context.storageState(),
    });

    const setupResp = await apiCtx.post('/api/v1/auth/totp/setup', { data: {} });
    expect(setupResp.status()).toBe(200);
    const setup = (await setupResp.json()) as { secret: string; qrUri: string };
    expect(setup.secret).toMatch(/^[A-Z2-7]+$/);

    const code = totp(setup.secret);
    const verifyResp = await apiCtx.post('/api/v1/auth/totp/verify', {
      data: { code },
    });
    expect(verifyResp.status()).toBe(200);
    const verifyBody = (await verifyResp.json()) as { backupCodes: string[] };
    expect(verifyBody.backupCodes.length).toBeGreaterThan(0);

    // ── 5. Logout via the daemon API ──────────────────────────────────────
    const logoutResp = await apiCtx.post('/api/v1/auth/logout');
    expect([200, 204]).toContain(logoutResp.status());

    // Replace the browser's storage with the now-logged-out state so the
    // next page-level navigation runs the auth-required guard.
    await context.clearCookies();

    // ── 6. Fresh login through the SPA — daemon now requires TOTP ─────────
    await page.goto('/login');
    await page.getByTestId('email-input').fill('root');
    await page.getByTestId('password-input').fill(ROOT_PASSWORD);
    await page.getByTestId('login-submit').click();

    await expect(page).toHaveURL(/\/totp/, { timeout: 15000 });

    const challengeCode = totp(setup.secret);
    await page.getByTestId('totp-pin-input').first().focus();
    await page.keyboard.type(challengeCode);

    await expect(page).not.toHaveURL(/\/totp/, { timeout: 15000 });

    // ── 7. Drain mailpit, request a password reset, fetch the email ───────
    const mailpit = await pwRequest.newContext({ baseURL: MAILPIT_BASE });
    await mailpit.delete('/api/v1/messages');

    // Use the SPA's forgot-password flow.
    await page.goto('/forgot-password');
    await page.getByTestId('forgot-email-input').fill(ROOT_EMAIL);
    await page.getByTestId('forgot-submit').click();
    await expect(page.getByTestId('reset-success-message')).toBeVisible({
      timeout: 15000,
    });

    // Poll mailpit for the email (max 10 s).
    let resetToken: string | null = null;
    for (let i = 0; i < 20 && resetToken === null; i += 1) {
      const list = await mailpit.get('/api/v1/messages?limit=10');
      const json = (await list.json()) as {
        messages?: { ID: string; To?: { Address: string }[] }[];
      };
      const found = (json.messages ?? []).find((m) =>
        (m.To ?? []).some((t) => t.Address === ROOT_EMAIL),
      );
      if (found !== undefined) {
        const msgResp = await mailpit.get(`/api/v1/message/${found.ID}`);
        const msg = (await msgResp.json()) as { Text?: string; HTML?: string };
        const body = `${msg.Text ?? ''}\n${msg.HTML ?? ''}`;
        const captured = /[?&]token=([^"&\s]+)/.exec(body)?.[1];
        if (captured !== undefined) resetToken = captured;
      }
      if (resetToken === null) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    }
    expect(resetToken, 'reset token should be present in mailpit message').not.toBeNull();

    // ── 8. Apply the new password via the daemon ──────────────────────────
    const applyResp = await apiCtx.post('/api/v1/auth/password-reset/apply', {
      data: { token: resetToken, password: NEW_PASSWORD },
    });
    expect(applyResp.status()).toBe(200);

    // ── 9. Old password rejected, new password accepted ───────────────────
    await context.clearCookies();
    await page.goto('/login');
    await page.getByTestId('email-input').fill('root');
    await page.getByTestId('password-input').fill(ROOT_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('email-input').fill('root');
    await page.getByTestId('password-input').fill(NEW_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/totp/, { timeout: 15000 });

    const finalCode = totp(setup.secret);
    await page.getByTestId('totp-pin-input').first().focus();
    await page.keyboard.type(finalCode);
    await expect(page).not.toHaveURL(/\/totp/, { timeout: 15000 });

    await apiCtx.dispose();
    await mailpit.dispose();
  });
});
