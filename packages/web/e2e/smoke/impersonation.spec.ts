/**
 * E2E smoke test — impersonation entry + exit flow.
 *
 * Task 1d.80
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The impersonation banner is a global UI element on /admin and /t/{tenant}
// surfaces — if one test starts a session and the daemon record doesn't end
// when the test finishes, the banner persists and intercepts pointer events
// on every later test that lands on those routes (the bell button, anything
// in the top-bar). Configure the file to run serially within its worker so
// the cleanup hook below sees a deterministic state, and reap any session
// that leaks past the end of each test.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ context }) => {
  // Clear localStorage so any client-side impersonation state from a prior
  // test is gone before the form mounts.
  await context.addInitScript(() => {
    localStorage.clear();
  });
});

test.afterEach(async ({ playwright, baseURL }) => {
  // Reap any active impersonation sessions on the daemon so the banner
  // doesn't bleed into the next file's tests (notifications, audit, …).
  const base = baseURL ?? 'http://localhost:7778';
  const api = await playwright.request.newContext({
    baseURL: base,
    storageState: 'e2e/.auth/root-state.json',
  });
  try {
    const res = await api.get(`${base}/api/v1/admin/impersonation`, {
      failOnStatusCode: false,
    });
    if (!res.ok()) return;
    const body = (await res.json()) as { sessions?: { id?: string }[] };
    const sessions = body.sessions ?? [];
    for (const s of sessions) {
      if (typeof s.id !== 'string' || s.id === '') continue;
      await api.delete(`${base}/api/v1/admin/impersonation/${s.id}`, {
        failOnStatusCode: false,
      });
    }
  } finally {
    await api.dispose();
  }
});

test('impersonation: enter session and banner appears', async ({ page }) => {
  // Navigate to the impersonation form
  await page.goto('/admin/impersonate');

  // Wait for form to load
  await expect(page.getByRole('heading', { name: /start impersonation session/i })).toBeVisible();

  // Select tenant — click the tenant select and pick the first option
  // Wait for the Target tenant Select to populate before clicking — the
  // Select is disabled while `useListAdminTenants` is in-flight, and on
  // CI runners that initial fetch is occasionally slower than the
  // Mantine paint, leaving us with a no-op click on a disabled button.
  const tenantSelect = page.getByRole('combobox', { name: /target tenant/i });
  await expect(tenantSelect).toBeEnabled({ timeout: 15_000 });
  await tenantSelect.click();
  // Mantine Combobox renders options with role="option" inside a
  // portal; pick the first non-empty option deterministically.
  const tenantOption = page.getByRole('option').first();
  await expect(tenantOption).toBeVisible({ timeout: 10_000 });
  await tenantOption.click();

  // Fill reason (required, min 20 chars)
  await page.getByLabel(/reason/i).fill('E2E test impersonation for smoke testing');

  // Fill TOTP code — validated client-side as 6 digits; daemon does not
  // verify TOTP for impersonation start (it validates auth at session login).
  await page.getByLabel(/totp code/i).fill('123456');

  // Submit the form
  await page.getByRole('button', { name: /start impersonation session/i }).click();

  // Should navigate to the tenant dashboard
  await expect(page).toHaveURL(/\/t\/[^/]+\/dashboard/);

  // Amber banner should be visible
  await expect(page.getByText(/acting as super-admin in/i)).toBeVisible();

  // "End session" button should be visible in the banner
  await expect(page.getByRole('button', { name: /end session/i })).toBeVisible();
});

test('impersonation: exit session via banner button', async ({ page }) => {
  // Start session first
  await page.goto('/admin/impersonate');
  await expect(page.getByRole('heading', { name: /start impersonation session/i })).toBeVisible();

  const tenantSelect = page.getByRole('combobox', { name: /target tenant/i });
  await expect(tenantSelect).toBeEnabled({ timeout: 15_000 });
  await tenantSelect.click();
  const opt = page.getByRole('option').first();
  await expect(opt).toBeVisible({ timeout: 10_000 });
  await opt.click();

  await page.getByLabel(/reason/i).fill('E2E test impersonation exit flow smoke test');
  await page.getByLabel(/totp code/i).fill('123456');
  await page.getByRole('button', { name: /start impersonation session/i }).click();

  // Wait for redirect to tenant dashboard with banner
  await expect(page).toHaveURL(/\/t\/[^/]+\/dashboard/);
  await expect(page.getByText(/acting as super-admin in/i)).toBeVisible();

  // Click the "End session" button
  await page.getByRole('button', { name: /end session/i }).click();

  // Confirm dialog should appear
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/end impersonation session/i)).toBeVisible();

  // Confirm exit — the modal's confirm button uses a distinct label to avoid
  // a strict-mode collision with the banner's own "End session" button.
  await page.getByRole('button', { name: /yes, end session/i }).click();

  // Banner should disappear
  await expect(page.getByText(/acting as super-admin in/i)).not.toBeVisible();

  // Should have navigated back to /admin
  await expect(page).toHaveURL('/admin');
});

test('impersonation banner: no serious a11y violations during active session', async ({ page }) => {
  // Start session
  await page.goto('/admin/impersonate');
  await expect(page.getByRole('heading', { name: /start impersonation session/i })).toBeVisible();

  const tenantSelect = page.getByRole('combobox', { name: /target tenant/i });
  await expect(tenantSelect).toBeEnabled({ timeout: 15_000 });
  await tenantSelect.click();
  const opt = page.getByRole('option').first();
  await expect(opt).toBeVisible({ timeout: 10_000 });
  await opt.click();

  await page.getByLabel(/reason/i).fill('E2E accessibility test for impersonation banner');
  await page.getByLabel(/totp code/i).fill('123456');
  await page.getByRole('button', { name: /start impersonation session/i }).click();

  await expect(page).toHaveURL(/\/t\/[^/]+\/dashboard/);
  await expect(page.getByText(/acting as super-admin in/i)).toBeVisible();

  // Run axe on the page with the banner visible
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});
