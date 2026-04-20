/**
 * E2E smoke tests for the AI Traces page — Task 3e.23.
 *
 * Coverage:
 *   - Seeded traces render in the list for the acme tenant.
 *   - Row click opens the detail drawer showing prompt / completion /
 *     tool-calls sections.
 *   - Export CSV triggers a download event.
 *   - Live-tail toggle increments the live badge when a new trace is written
 *     from a separate page. (Marked fixme — cross-page mock-SSE is flaky: the
 *     second page clears localStorage on init and the mock-store instance is
 *     per-tab, so the bus bridge between tabs is not guaranteed. The assertion
 *     stays documented here as a forward-looking check.)
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('seeded traces render on /t/acme/ai/traces', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/ai/traces');

  await expect(page.getByRole('heading', { name: /^ai traces$/i })).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('trace detail drawer shows prompt + completion + tool_calls sections', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/ai/traces');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  // The detail container is tagged with data-testid="trace-detail".
  await expect(drawer.getByTestId('trace-detail')).toBeVisible();

  // Prompt + completion block. Derrick has ai-trace:read-sensitive so the
  // full view renders (not the redacted Alert).
  await expect(drawer.getByTestId('trace-prompt-completion')).toBeVisible({
    timeout: 10_000,
  });

  // Tool calls section header is always rendered (count may be 0).
  await expect(drawer.getByText(/^tool calls \(\d+\)/i)).toBeVisible();
});

test('Export CSV triggers a download', async ({ authedPage: page }) => {
  await page.goto('/t/acme/ai/traces');

  // Wait for rows to hydrate so the export has data.
  await expect(
    page.locator('tbody tr[role="row"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
  await page.getByTestId('export-csv').click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^ai-traces-\d{4}-\d{2}-\d{2}\.csv$/);
});

// Live-tail cross-tab assertion — documented but skipped due to isolation
// between Playwright browser contexts (each has its own localStorage + its
// own mock-store instance + its own mock-SSE EventTarget bus). Enabling this
// reliably requires a shared backend/bus, which the mock layer does not have.
test.fixme(
  'live-tail toggle surfaces new traces from an invocation on another page',
  async ({ authedPage: page, context }) => {
    await page.goto('/t/acme/ai/traces');

    // Enable live-tail.
    await page.getByTestId('live-tail-switch').click();

    // Open a second page in the same context and invoke an agent.
    const page2 = await context.newPage();
    await page2.goto('/t/acme/ai/agents');
    await page2.locator('tbody tr[role="row"]').first().click();
    const drawer2 = page2.getByRole('dialog');
    await drawer2.getByRole('textbox', { name: /^prompt$/i }).fill('cross-page tail probe');
    await drawer2.getByRole('button', { name: /^invoke$/i }).click();

    // The original page should surface an incremented live badge. Because
    // contexts are isolated, this assertion is expected to fail today.
    await expect(page.getByText(/LIVE \+\d+/)).toBeVisible({ timeout: 10_000 });
  },
);
