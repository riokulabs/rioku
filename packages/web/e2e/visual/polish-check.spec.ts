/**
 * Visual polish spot-check — Task 9a.3.
 *
 * Captures screenshots across:
 *   - Color schemes: dark, light
 *   - Key pages: dashboard, services list, settings profile,
 *     settings tls (has tables), api-explorer
 *   - Viewports: desktop (1280×720), tablet (768×1024), mobile (375×667)
 *
 * Assertions:
 *   1. Page loads without actionable console errors
 *   2. <body> scrollHeight > 0 (page is not empty)
 *   3. No horizontal overflow at tablet + mobile viewports (except api-explorer
 *      which uses Scalar's fixed-width rendering)
 *
 * RTL: set i18nextLng='ar' via localStorage; assert dir="rtl" on <html>.
 * Known gaps per spec: Monaco/Scalar/tiptap may have RTL layout issues.
 * Screenshots saved to e2e/screenshots/polish/ for human review (gitignored).
 */
import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Paths — use import.meta.url + URL to avoid node: imports in browser tsconfig
// ---------------------------------------------------------------------------

const POLISH_DIR = new URL('../screenshots/polish', import.meta.url)
  .pathname;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type ColorScheme = 'dark' | 'light';
interface Viewport {
  name: string;
  width: number;
  height: number;
}

const VIEWPORTS: Viewport[] = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 667 },
];

const COLOR_SCHEMES: ColorScheme[] = ['dark', 'light'];

interface PageConfig {
  name: string;
  path: string;
  waitTestId?: string;
  waitHeading?: RegExp;
  waitSignal?: (page: Page) => Promise<void>;
  /** Skip horizontal overflow check (e.g. third-party renderers) */
  skipOverflowCheck?: boolean;
}

const PAGES: PageConfig[] = [
  {
    name: 'dashboard',
    path: '/t/acme/dashboard',
    waitSignal: async (page) => {
      // DashboardViewer renders role="list" aria-label="... dashboard widgets"
      await expect(
        page.getByRole('list', { name: /dashboard widgets/i }),
      ).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    name: 'services',
    path: '/t/acme/services',
    waitHeading: /^services$/i,
  },
  {
    name: 'settings-profile',
    path: '/t/acme/settings/?section=profile',
    waitTestId: 'profile-section',
  },
  {
    name: 'settings-tls',
    path: '/t/acme/settings/?section=tls',
    waitTestId: 'tls-section',
  },
  {
    name: 'api-explorer',
    path: '/t/acme/api-explorer',
    waitTestId: 'api-explorer',
    // Scalar renders in its own shadow DOM / Vue runtime; its fixed-width
    // container may overflow narrow viewports by design.
    skipOverflowCheck: true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the mock store to be seeded with Derrick's session. */
async function waitForSeed(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const store = (
        window as unknown as {
          __RIOKU_STORE?: {
            getState: () => { currentUserId: string | null };
          };
        }
      ).__RIOKU_STORE;
      if (!store) return false;
      return store.getState().currentUserId !== null;
    },
    null,
    { timeout: 15_000 },
  );
}

/** Wait for page-specific ready signal. */
async function waitForReady(
  page: Page,
  config: PageConfig,
): Promise<void> {
  if (config.waitSignal) {
    await config.waitSignal(page);
  } else if (config.waitTestId) {
    await expect(page.getByTestId(config.waitTestId)).toBeVisible({
      timeout: 15_000,
    });
  } else if (config.waitHeading) {
    await expect(
      page.getByRole('heading', { name: config.waitHeading }).first(),
    ).toBeVisible({ timeout: 15_000 });
  }
}

/** Filter out non-actionable console noise. */
function isActionableError(msg: string): boolean {
  return (
    !msg.includes('ResizeObserver loop') &&
    !msg.includes('[vite]') &&
    !msg.includes('WebSocket') &&
    !msg.includes('i18next') &&
    !msg.includes('favicon')
  );
}

// ---------------------------------------------------------------------------
// Main test matrix: color scheme × page × viewport
// ---------------------------------------------------------------------------

for (const colorScheme of COLOR_SCHEMES) {
  for (const pageConfig of PAGES) {
    for (const viewport of VIEWPORTS) {
      const testName = `[${colorScheme}] ${pageConfig.name} @ ${viewport.name}`;

      test(testName, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });

        // Install init script: runs before React mounts on every navigation.
        await page.addInitScript((theme: string) => {
          localStorage.clear();
          localStorage.setItem('rioku-active-theme', theme);
        }, colorScheme);

        await page.goto(pageConfig.path);
        await waitForSeed(page);
        await waitForReady(page, pageConfig);

        // 1. Body is not empty
        const scrollHeight = await page.evaluate(
          () => document.body.scrollHeight,
        );
        expect(
          scrollHeight,
          'body.scrollHeight should be > 0',
        ).toBeGreaterThan(0);

        // 2. No horizontal overflow at narrow viewports
        if (
          !pageConfig.skipOverflowCheck &&
          (viewport.name === 'tablet' || viewport.name === 'mobile')
        ) {
          const scrollWidth = await page.evaluate(
            () => document.body.scrollWidth,
          );
          expect(
            scrollWidth,
            `Horizontal overflow: body.scrollWidth (${String(scrollWidth)}) > viewport width (${String(viewport.width)})`,
          ).toBeLessThanOrEqual(viewport.width + 5);
        }

        // 3. Screenshot
        const filename = `${colorScheme}__${pageConfig.name}__${viewport.name}.png`;
        await page.screenshot({ path: `${POLISH_DIR}/${filename}`, fullPage: false });
        console.log(`[polish] saved ${filename}`);

        // 4. No actionable console errors
        const actionableErrors = consoleErrors.filter(isActionableError);
        expect(
          actionableErrors,
          `Console errors on "${testName}":\n${actionableErrors.join('\n')}`,
        ).toHaveLength(0);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// RTL: Arabic locale — dashboard at desktop
// ---------------------------------------------------------------------------

test('[rtl] dashboard @ desktop — dir="rtl" applied', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.setViewportSize({ width: 1280, height: 720 });

  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('rioku-active-theme', 'dark');
    // i18next-browser-languagedetector reads this key on init.
    localStorage.setItem('i18nextLng', 'ar');
  });

  await page.goto('/t/acme/dashboard');
  await waitForSeed(page);

  // Wait for providers.tsx to apply dir="rtl" via useEffect
  await page.waitForFunction(
    () => document.documentElement.getAttribute('dir') === 'rtl',
    null,
    { timeout: 10_000 },
  );
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await expect(
    page.getByRole('list', { name: /dashboard widgets/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: `${POLISH_DIR}/rtl__dashboard__desktop.png`,
    fullPage: false,
  });
  console.log('[polish] saved rtl__dashboard__desktop.png');

  const actionableErrors = consoleErrors.filter(isActionableError);
  expect(
    actionableErrors,
    `Console errors in RTL test:\n${actionableErrors.join('\n')}`,
  ).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// RTL: Arabic locale — services at tablet (sidebar collapse + RTL)
// ---------------------------------------------------------------------------

test('[rtl] services @ tablet — sidebar + RTL layout', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.setViewportSize({ width: 768, height: 1024 });

  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('rioku-active-theme', 'dark');
    localStorage.setItem('i18nextLng', 'ar');
  });

  await page.goto('/t/acme/services');
  await waitForSeed(page);

  await page.waitForFunction(
    () => document.documentElement.getAttribute('dir') === 'rtl',
    null,
    { timeout: 10_000 },
  );
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await expect(
    page.getByRole('heading', { name: /^services$/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  expect(scrollHeight).toBeGreaterThan(0);

  await page.screenshot({
    path: `${POLISH_DIR}/rtl__services__tablet.png`,
    fullPage: false,
  });
  console.log('[polish] saved rtl__services__tablet.png');

  const actionableErrors = consoleErrors.filter(isActionableError);
  expect(
    actionableErrors,
    `Console errors in RTL tablet test:\n${actionableErrors.join('\n')}`,
  ).toHaveLength(0);
});
