/**
 * E2E smoke tests for the Cluster management page — Plan 10.
 *
 * Coverage:
 *   - Page renders with heading and summary cards
 *   - Seeded nodes appear in the node list table
 *   - Row click opens the node detail drawer
 *   - "Enroll node" button opens the enroll modal and token can be generated
 *   - Active enrollment tokens table is visible
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('cluster page renders with heading and nodes', async ({ authedPage: page }) => {
  await page.goto('/t/acme/cluster');

  await expect(page.getByRole('heading', { name: /^cluster$/i })).toBeVisible();

  // Summary cards — at least "Total nodes" should be visible
  await expect(page.getByText(/total nodes/i)).toBeVisible({ timeout: 10_000 });

  // At least one node row in the table
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('node list shows role and status badges', async ({ authedPage: page }) => {
  await page.goto('/t/acme/cluster');
  await expect(page.getByRole('heading', { name: /^cluster$/i })).toBeVisible();

  // We expect at least a "primary" role badge
  await expect(page.getByText(/primary/i).first()).toBeVisible({ timeout: 10_000 });
});

test('clicking a row opens the node detail drawer', async ({ authedPage: page }) => {
  await page.goto('/t/acme/cluster');
  await expect(page.getByRole('heading', { name: /^cluster$/i })).toBeVisible();

  const firstRow = page.locator('tbody tr').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  // Drawer opens with "Node details" title
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/node details/i)).toBeVisible();
});

test('enroll modal generates a token and shows join command', async ({ authedPage: page }) => {
  await page.goto('/t/acme/cluster');
  await expect(page.getByRole('heading', { name: /^cluster$/i })).toBeVisible();

  // Click Enroll node button
  const enrollBtn = page.getByRole('button', { name: /enroll node/i });
  await expect(enrollBtn).toBeVisible({ timeout: 10_000 });
  await enrollBtn.click();

  // Modal opens
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await expect(modal.getByText(/enroll new cluster node/i)).toBeVisible();

  // Generate token
  const generateBtn = modal.getByRole('button', { name: /generate token/i });
  await expect(generateBtn).toBeVisible();
  await generateBtn.click();

  // Token and join command appear
  await expect(modal.getByText(/join command/i)).toBeVisible({ timeout: 8_000 });
  await expect(modal.getByText(/rioku cluster join/i)).toBeVisible();
});

test('active enrollment tokens section is visible', async ({ authedPage: page }) => {
  await page.goto('/t/acme/cluster');
  await expect(page.getByRole('heading', { name: /^cluster$/i })).toBeVisible();

  await expect(page.getByRole('heading', { name: /active enrollment tokens/i })).toBeVisible({
    timeout: 10_000,
  });
});
