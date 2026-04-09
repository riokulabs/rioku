import { test, expect } from '@playwright/test';
import { anonTest, adminTest } from './fixtures';

test.describe('Auth Flow', () => {
  anonTest('unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  anonTest('login with valid admin credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill('testadmin');
    await page.getByLabel('Password').fill('TestAdmin123!');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL('/');
  });

  anonTest('login with wrong password shows error and stays on login page', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill('testadmin');
    await page.getByLabel('Password').fill('WrongPassword!');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByText('Invalid username or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  // Sandbox may not have a locked user seeded — skip until confirmed
  anonTest.fixme('login with locked account shows locked error', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill('testlocked');
    await page.getByLabel('Password').fill('TestLocked123!');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByText('Account is locked')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  // Sandbox may not have a suspended user seeded — skip until confirmed
  anonTest.fixme('login with suspended account shows suspended error', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill('testsuspended');
    await page.getByLabel('Password').fill('TestSusp123!');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByText('Account suspended')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  adminTest('session cookie persists across page reload', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');

    await page.reload();
    await expect(page).toHaveURL('/');
  });

  adminTest('cookie is HttpOnly (not accessible from JS)', async ({ page }) => {
    // The adminTest fixture logs in via `page`, so the session cookie is set
    // on that page's browser context. Derive the context from the page.
    const ctx = page.context();
    const cookies = await ctx.cookies('http://localhost:7778');
    const sessionCookie = cookies.find((c) => c.name === 'rioku_sid');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);
  });

  adminTest('authenticated user can navigate to all pages without redirect', async ({ page }) => {
    const protectedPaths = [
      '/',
      '/config/routes',
      '/config/services',
      '/config/policies',
      '/security',
      '/traffic/live',
      '/traffic/analytics',
      '/audit',
      '/cluster',
      '/plugins',
      '/settings',
      '/settings/profile',
      '/settings/users',
      '/settings/roles',
    ];

    for (const path of protectedPaths) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/login/);
    }
  });

  adminTest('logout redirects to /login and clears session', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');

    // Click logout button in the sidebar footer
    await page.getByRole('button', { name: /log\s*out/i }).click();

    await expect(page).toHaveURL(/\/login/);

    // Attempting to visit protected page should redirect back to login
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  // Root user login requires sandbox root-password file — fixme until sandbox is stable
  anonTest.fixme('root user login redirects to /change-password', async ({ page }) => {
    const fs = await import('fs');
    const rootPw = fs.readFileSync('../../sandbox/.data/root-password', 'utf-8').trim();

    await page.goto('/login');
    await page.getByLabel('Username').fill('root');
    await page.getByLabel('Password').fill(rootPw);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL(/\/change-password/);
    await expect(page.getByText('Change your password')).toBeVisible();
  });
});
