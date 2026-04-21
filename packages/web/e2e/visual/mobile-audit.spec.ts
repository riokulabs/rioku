/**
 * Mobile responsiveness audit — iPhone 12 Pro (390×844) viewport.
 *
 * For each key page:
 *   1. Captures a screenshot to e2e/screenshots/mobile/<slug>.png
 *   2. HARD asserts: document.documentElement.scrollWidth <= window.innerWidth + 2
 *      (2px subpixel tolerance) — no horizontal body overflow.
 *   3. Asserts sidebar is collapsed (not occupying viewport space) OR a burger
 *      toggle is visible.
 *
 * Run: pnpm test:e2e -- visual/mobile-audit.spec.ts
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';

// ── Viewport — iPhone 12 Pro ──────────────────────────────────────────────────

const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  isMobile: true,
  deviceScaleFactor: 3,
  hasTouch: true,
};

// ── Screenshot directory ──────────────────────────────────────────────────────

const SCREENSHOTS_DIR = new URL('../screenshots/mobile', import.meta.url).pathname;

// ── Page configs ──────────────────────────────────────────────────────────────

interface MobilePageConfig {
  slug: string;
  path: string;
  waitTestId?: string;
  waitHeading?: RegExp;
  waitSignal?: (page: Page) => Promise<void>;
  /** Skip overflow check for third-party renderers (e.g. Scalar) */
  skipOverflowCheck?: boolean;
}

const PAGES: MobilePageConfig[] = [
  {
    slug: 'dashboard',
    path: '/t/acme/dashboard',
    // Dashboard may render DashboardViewer (when a default dashboard exists)
    // or StockDashboard (heading "Dashboard"). Use a generic content check.
    waitSignal: async (page) => {
      // Wait for either the stock heading OR the dashboard viewer widget list
      await Promise.race([
        page.getByRole('heading', { name: /^dashboard$/i }).first().waitFor({ timeout: 15_000 }),
        page.getByRole('list', { name: /dashboard widgets/i }).waitFor({ timeout: 15_000 }),
        // Fallback: at minimum the AppShell main content should be present
        page.locator('[data-type="main"]').waitFor({ timeout: 15_000 }),
      ]);
    },
  },
  {
    slug: 'services',
    path: '/t/acme/services',
    waitHeading: /^services$/i,
  },
  {
    slug: 'ai-agents',
    path: '/t/acme/ai/agents',
    waitHeading: /^ai agents$/i,
  },
  {
    slug: 'ai-traces',
    path: '/t/acme/ai/traces',
    waitHeading: /^ai traces$/i,
  },
  {
    slug: 'dashboards',
    path: '/t/acme/dashboards',
    waitHeading: /^dashboards$/i,
    // Title is "Dashboards" (order 2)
  },
  {
    slug: 'notifications',
    path: '/t/acme/notifications',
    waitHeading: /^notifications$/i,
    // Title is "Notifications" (order 2)
  },
  {
    slug: 'settings-profile',
    path: '/t/acme/settings/?section=profile',
    waitTestId: 'profile-section',
  },
  {
    slug: 'settings-tls',
    path: '/t/acme/settings/?section=tls',
    waitTestId: 'tls-section',
  },
  {
    slug: 'settings-danger-zone',
    path: '/t/acme/settings/?section=danger-zone',
    waitTestId: 'danger-zone-section',
  },
  {
    slug: 'api-explorer',
    path: '/t/acme/api-explorer',
    waitTestId: 'api-explorer',
    // Scalar renders in its own shadow DOM / Vue runtime with a fixed-width
    // container that may overflow narrow viewports by design.
    skipOverflowCheck: true,
  },
  {
    slug: 'plugins',
    path: '/t/acme/plugins',
    waitHeading: /^plugins$/i,
    // Title is "Plugins" (order 2)
  },
  {
    slug: 'security-users',
    path: '/t/acme/security/users',
    waitHeading: /^users$/i,
    // Title is "Users" (order 2)
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForReady(page: Page, config: MobilePageConfig): Promise<void> {
  if (config.waitSignal) {
    await config.waitSignal(page);
  } else if (config.waitTestId) {
    await expect(page.getByTestId(config.waitTestId)).toBeVisible({ timeout: 15_000 });
  } else if (config.waitHeading) {
    await expect(
      page.getByRole('heading', { name: config.waitHeading }).first(),
    ).toBeVisible({ timeout: 15_000 });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('mobile audit — iPhone 12 Pro (390×844)', () => {
  for (const pageConfig of PAGES) {
    test(pageConfig.slug, async ({ authedPage: page }) => {
      // Apply mobile viewport
      await page.setViewportSize({
        width: MOBILE_VIEWPORT.width,
        height: MOBILE_VIEWPORT.height,
      });

      await page.goto(pageConfig.path);
      await waitForReady(page, pageConfig);

      // ── Screenshot ───────────────────────────────────────────────────────
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/${pageConfig.slug}.png`, fullPage: true });

      // ── Overflow assertion ───────────────────────────────────────────────
      if (!pageConfig.skipOverflowCheck) {
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(
          scrollWidth,
          `Horizontal overflow on ${pageConfig.slug}: scrollWidth (${String(scrollWidth)}) > innerWidth (${String(innerWidth)}) + 2`,
        ).toBeLessThanOrEqual(innerWidth + 2);
      }

      // ── Sidebar check ────────────────────────────────────────────────────
      // The AppShell navbar is collapsed on mobile (breakpoint: 'sm' = 768px).
      // The navbar element should not be visible (Mantine adds display:none
      // or transforms it off-screen). A burger/toggle may be present.
      //
      // Strategy: check that the nav element's bounding box width is ≤ 0
      // (hidden) OR a burger toggle button is visible.
      const sidebarInfo = await page.evaluate(() => {
        const nav = document.querySelector('[data-type="navbar"]');
        if (!(nav instanceof HTMLElement)) return { found: false, width: 0, visible: false };
        const rect = nav.getBoundingClientRect();
        const style = window.getComputedStyle(nav);
        return {
          found: true,
          width: rect.width,
          visible: style.display !== 'none' && rect.width > 0,
        };
      });

      if (sidebarInfo.found && sidebarInfo.visible) {
        // Sidebar is visible — assert it's not stealing more than 50% of viewport
        // (this is a soft guard; the overflow assertion above is the hard check).
        // If sidebar is > 200px wide on a 390px viewport, that's a bug.
        const burgerVisible = await page
          .getByRole('button', { name: /toggle navigation|open navigation|burger/i })
          .isVisible()
          .catch(() => false);

        expect(
          sidebarInfo.width <= 200 || burgerVisible,
          `Sidebar is ${String(sidebarInfo.width)}px wide on 390px viewport — either collapse it or show a burger toggle`,
        ).toBe(true);
      }
    });
  }
});
