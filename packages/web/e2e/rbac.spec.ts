import { expect } from '@playwright/test';
import { adminTest, viewerTest, operatorTest } from './fixtures';

adminTest.describe('RBAC — Admin visibility', () => {
  adminTest('admin sees all navigation items including Users and Roles', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    // Core nav items from navSections (English translations in common.json)
    await expect(sidebar.getByText('Dashboard', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Routes', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Services', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Policies', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Live', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Analytics', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('AI Workloads', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Cluster', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Plugins', { exact: true })).toBeVisible();
    // Security section — the heading "Security" is the section label;
    // "Security" also appears as a nav item. Use the menu-button locator to be precise.
    await expect(sidebar.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: 'Security' })).toBeVisible();
    // Admin can see Users and Roles (permission-gated items)
    await expect(sidebar.getByText('Users', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Roles', { exact: true })).toBeVisible();
  });
});

viewerTest.describe('RBAC — Viewer visibility', () => {
  viewerTest('viewer sees read-only nav, not Users or Roles', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await expect(sidebar.getByText('Dashboard', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Routes', { exact: true })).toBeVisible();
    // Users and Roles should be hidden for viewer (no users:read / roles:read permissions)
    await expect(sidebar.getByText('Users', { exact: true })).not.toBeVisible();
    await expect(sidebar.getByText('Roles', { exact: true })).not.toBeVisible();
  });

  viewerTest('viewer navigating directly to /settings/users is blocked', async ({ page }) => {
    await page.goto('/settings/users');

    // The UsersPage component checks useHasPermission('users:read') and renders
    // an "Access denied" EmptyState if false. The route itself does not redirect.
    const url = page.url();
    const isForbidden =
      url.includes('/login') ||
      url === 'http://localhost:7778/' ||
      (await page.getByText(/access denied/i).isVisible().catch(() => false)) ||
      (await page.getByText(/not authorized/i).isVisible().catch(() => false)) ||
      (await page.getByText(/do not have permission/i).isVisible().catch(() => false));
    expect(isForbidden).toBe(true);
  });
});

operatorTest.describe('RBAC — Operator visibility', () => {
  operatorTest('operator sees config nav but not Users or Roles', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await expect(sidebar.getByText('Routes', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Services', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Policies', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Users', { exact: true })).not.toBeVisible();
    await expect(sidebar.getByText('Roles', { exact: true })).not.toBeVisible();
  });
});
