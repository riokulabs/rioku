import { expect } from '@playwright/test';
import { adminTest, viewerTest, operatorTest } from './fixtures';

adminTest.describe('RBAC — Admin visibility', () => {
  adminTest('admin sees all navigation items including Users and Roles', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await expect(sidebar.getByText('Dashboard')).toBeVisible();
    await expect(sidebar.getByText('Routes')).toBeVisible();
    await expect(sidebar.getByText('Services')).toBeVisible();
    await expect(sidebar.getByText('Policies')).toBeVisible();
    await expect(sidebar.getByText('Security')).toBeVisible();
    await expect(sidebar.getByText('Users')).toBeVisible();
    await expect(sidebar.getByText('Roles')).toBeVisible();
    await expect(sidebar.getByText('Live')).toBeVisible();
    await expect(sidebar.getByText('Analytics')).toBeVisible();
  });
});

viewerTest.describe('RBAC — Viewer visibility', () => {
  viewerTest('viewer sees read-only nav, not Users or Roles', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await expect(sidebar.getByText('Dashboard')).toBeVisible();
    await expect(sidebar.getByText('Routes')).toBeVisible();
    await expect(sidebar.getByText('Users')).not.toBeVisible();
    await expect(sidebar.getByText('Roles')).not.toBeVisible();
  });

  viewerTest('viewer navigating directly to /settings/users is blocked', async ({ page }) => {
    await page.goto('/settings/users');

    // Should either redirect away or show forbidden
    const url = page.url();
    const isForbidden =
      url.includes('/login') ||
      url === 'http://localhost:7778/' ||
      (await page.getByText(/forbidden|not authorized|access denied/i).isVisible().catch(() => false));
    expect(isForbidden).toBe(true);
  });
});

operatorTest.describe('RBAC — Operator visibility', () => {
  operatorTest('operator sees config nav but not Users or Roles', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await expect(sidebar.getByText('Routes')).toBeVisible();
    await expect(sidebar.getByText('Services')).toBeVisible();
    await expect(sidebar.getByText('Policies')).toBeVisible();
    await expect(sidebar.getByText('Users')).not.toBeVisible();
    await expect(sidebar.getByText('Roles')).not.toBeVisible();
  });
});
