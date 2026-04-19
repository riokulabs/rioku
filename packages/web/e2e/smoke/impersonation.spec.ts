/**
 * E2E smoke test — impersonation entry + exit flow.
 *
 * Task 1d.80
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ context }) => {
  // Clear localStorage so the mock store is freshly seeded for each test.
  await context.addInitScript(() => {
    localStorage.clear();
  });
});

test('impersonation: enter session and banner appears', async ({ page }) => {
  // Navigate to the impersonation form
  await page.goto('/admin/impersonate');

  // Wait for form to load
  await expect(page.getByRole('heading', { name: /start impersonation session/i })).toBeVisible();

  // Select tenant — click the tenant select and pick the first option
  const tenantSelect = page.getByLabel(/target tenant/i);
  await tenantSelect.click();
  // Wait for dropdown options — pick any tenant option
  const tenantOption = page.getByRole('option').first();
  await tenantOption.click();

  // Fill reason (required, min 20 chars)
  await page.getByLabel(/reason/i).fill('E2E test impersonation for smoke testing');

  // Fill TOTP code (any 6 digits accepted in stage 1)
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

  const tenantSelect = page.getByLabel(/target tenant/i);
  await tenantSelect.click();
  await page.getByRole('option').first().click();

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

  // Confirm exit
  await page.getByRole('button', { name: /end session/i, exact: true }).click();

  // Banner should disappear
  await expect(page.getByText(/acting as super-admin in/i)).not.toBeVisible();

  // Should have navigated back to /admin
  await expect(page).toHaveURL('/admin');
});

test('impersonation banner: no serious a11y violations during active session', async ({ page }) => {
  // Start session
  await page.goto('/admin/impersonate');
  await expect(page.getByRole('heading', { name: /start impersonation session/i })).toBeVisible();

  const tenantSelect = page.getByLabel(/target tenant/i);
  await tenantSelect.click();
  await page.getByRole('option').first().click();

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
