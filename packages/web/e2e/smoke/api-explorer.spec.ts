/**
 * E2E smoke test for the API Explorer page.
 *
 * Verifies that the Scalar-backed OpenAPI reference renders correctly on
 * /t/acme/api-explorer — i.e. no console errors, the host container is
 * visible, and Scalar's DOM nodes are present.
 *
 * A screenshot is saved to e2e/screenshots/api-explorer.png for visual
 * inspection when diagnosing rendering failures. The screenshots directory
 * is listed in .gitignore.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

// Resolved at runtime — no node: imports needed in the main tsconfig project.
const SCREENSHOTS_DIR = new URL('../../e2e/screenshots', import.meta.url).pathname;
const SCREENSHOT_PATH = `${SCREENSHOTS_DIR}/api-explorer.png`;

test('API explorer renders the Scalar reference UI', async ({ authedPage: page }) => {
  const consoleErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto('/t/acme/api-explorer');

  // Wait for the lazy chunk to load and Scalar to mount.
  const container = page.locator('[data-testid="api-explorer"]');
  await expect(container).toBeVisible({ timeout: 20000 });

  // Log rendered HTML snippet for inspection.
  const html = await container.innerHTML();
  // Print first 1000 chars so CI logs show the shape of what rendered.
  console.log('[api-explorer] inner HTML (first 1000 chars):\n', html.slice(0, 1000));

  // Log spec preview so we can confirm content is passed in.
  const specPreview: string = await page.evaluate(() => {
    // Grab a small slice of the body text to confirm the page isn't blank.
    return document.body.innerText.slice(0, 200);
  });
  console.log('[api-explorer] body text preview:\n', specPreview);

  // Scalar v0.9.x renders Vue internals inside `<div data-v-app="">`.
  // Check for Scalar-specific class names or data attributes.
  const scalarRoot = container.locator('[data-v-app], .scalar-app, [class*="scalar"]').first();
  const hasScalarDom = (await scalarRoot.count()) > 0;
  console.log('[api-explorer] Scalar DOM nodes found:', hasScalarDom);

  // Fallback: if the Scalar class names changed, assert the body contains
  // meaningful API reference content.
  if (!hasScalarDom) {
    await expect(page.locator('body')).toContainText(/api|paths|openapi|reference/i, {
      timeout: 15000,
    });
  } else {
    await expect(scalarRoot).toBeVisible({ timeout: 15000 });
  }

  // Visual sanity: assert no images inside the explorer are giant (broken
  // layout indicator).  Without Scalar's style.css the client-libraries icons
  // and logo SVGs render at natural size (~800-1000px tall).  With styles
  // loaded they are capped to 14px (icons) or small fixed heights.
  const oversizedImages = await container.locator('img, svg').evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).clientHeight > 600)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        clientHeight: (el as HTMLElement).clientHeight,
        clientWidth: (el as HTMLElement).clientWidth,
        src: el instanceof HTMLImageElement ? el.src : '',
        id: (el as HTMLElement).id.slice(0, 80),
      })),
  );

  if (oversizedImages.length > 0) {
    console.error(
      '[api-explorer] oversized images/SVGs (layout broken):\n',
      JSON.stringify(oversizedImages, null, 2),
    );
  }
  expect(
    oversizedImages,
    `Expected no images/SVGs taller than 600px inside the explorer — Scalar style.css may be missing.\n${JSON.stringify(oversizedImages, null, 2)}`,
  ).toHaveLength(0);

  // Screenshot for visual debugging (saved to e2e/screenshots/, git-ignored).
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  console.log('[api-explorer] screenshot saved to', SCREENSHOT_PATH);

  // Assert no console errors occurred during render.
  // Print them first so CI output identifies the exact errors before the
  // assertion fails.
  if (consoleErrors.length > 0) {
    console.error('[api-explorer] console errors during render:\n', consoleErrors.join('\n'));
  }
  expect(
    consoleErrors,
    `Expected no console errors but got:\n${consoleErrors.join('\n')}`,
  ).toHaveLength(0);
});
