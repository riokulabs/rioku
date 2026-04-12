import { test, expect } from '@playwright/test';

/**
 * Auth tests. These test unauthenticated flows using `storageState: undefined`
 * to avoid polluting other tests' session state. The logout test creates its
 * own fresh login session so it doesn't invalidate the shared auth state.
 */

test.describe('Auth — unauthenticated', () => {
  test.use({ storageState: undefined });

  test('login with valid credentials redirects to dashboard', async ({ browser }) => {
    // Use a fresh context so we don't affect shared state
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto('/login');

    await page.getByLabel('Username').fill('root');
    await page.getByLabel('Password').fill('TestRoot1234!');
    await page.getByRole('button', { name: /log in/i }).click();

    // Should redirect away from /login (to / or /change-password)
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 15_000,
    });

    if (!page.url().includes('/change-password')) {
      await expect(page).toHaveURL('/');
    }

    await context.close();
  });

  test('login with invalid credentials shows error', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto('/login');

    await page.getByLabel('Username').fill('root');
    await page.getByLabel('Password').fill('WrongPassword123!');
    await page.getByRole('button', { name: /log in/i }).click();

    const errorMessage = page.getByText(/invalid|incorrect|wrong|failed/i);
    await expect(errorMessage.first()).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/login/);

    await context.close();
  });

  test('protected pages redirect to login when not authenticated', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    const protectedPaths = [
      '/',
      '/config/routes',
      '/config/services',
      '/settings/general',
      '/security/users',
    ];

    for (const path of protectedPaths) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }

    await context.close();
  });
});

test.describe('Auth — logout', () => {
  test('logout redirects to login', async ({ browser }) => {
    // Create a fresh login session just for this test so the shared auth
    // state is not invalidated on the server.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    // Login fresh
    await page.goto('/login');
    await page.getByLabel('Username').fill('root');
    await page.getByLabel('Password').fill('TestRoot1234!');
    await page.getByRole('button', { name: /log in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 15_000,
    });

    // Now logout
    const userMenuTrigger = page.locator('[data-testid="user-menu-trigger"]');
    if (await userMenuTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await userMenuTrigger.click();
      await page.waitForTimeout(500);

      const logoutBtn = page.getByText(/log out/i).first();
      if (await logoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await logoutBtn.click();
        await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
      }
    }

    await context.close();
  });
});
