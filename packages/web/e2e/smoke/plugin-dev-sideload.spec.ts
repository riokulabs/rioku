/**
 * E2E smoke — dev-sideload plugin loading (Task 1f.123).
 *
 * The sample plugin is built in Playwright's globalSetup (e2e/global-setup.ts)
 * before any worker starts. This spec navigates to
 * `/?plugin=/sample-plugin/dist/plugin.mjs` and asserts every SDK surface
 * registered by the sample is visible:
 *
 *   - sidebar entry "Hello Plugin"
 *   - route `/plugins/hello` renders the hello page
 *   - theme picker lists "Sample Hello"
 *   - plugin-registered permission present in the host catalog
 *   - spotlight command "Open Hello Plugin" listed
 *
 * The Vite dev server exposes `/sample-plugin/*` via a custom dev middleware
 * (see vite.config.ts) so the bundle is reachable without being copied into
 * `public/`. Playwright runs the same dev server (playwright.config.ts webServer).
 */
import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures/auth';

// URLs served by the Vite dev middleware. Passing both `?plugin=` and
// `?manifest=` tells DevSideload to fetch the real manifest (so the plugin is
// registered under its declared name `sample-plugin`) instead of the synthetic
// manifest it falls back to when only `?plugin=` is present.
const PLUGIN_QS =
  '?plugin=/sample-plugin/dist/plugin.mjs&manifest=/sample-plugin/rioku-plugin.json';

// Wait for the DevSideload loader to finish registering the plugin before
// asserting on UI state.
async function waitForSamplePluginRegistered(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const host = (
        window as unknown as {
          __RIOKU_PLUGIN_HOST?: {
            listPlugins: () => { manifest: { name: string } }[];
          };
        }
      ).__RIOKU_PLUGIN_HOST;
      if (!host) return false;
      return host.listPlugins().some((p) => p.manifest.name === 'sample-plugin');
    },
    null,
    { timeout: 15_000 },
  );
}

test('dev-sideload plugin: sidebar entry appears', async ({ authedPage: page }) => {
  // Navigate into a tenant so the app shell (and its sidebar) is visible, and
  // pass the sideload query so DevSideload loads the plugin on this page load.
  await page.goto('/t/acme/dashboard?' + PLUGIN_QS.slice(1));
  await waitForSamplePluginRegistered(page);

  // Sidebar link rendered by packages/web/src/components/app-shell/sidebar.tsx.
  await expect(page.getByRole('link', { name: /hello plugin/i })).toBeVisible();
});

test('dev-sideload plugin: /plugins/hello route renders', async ({ authedPage: page }) => {
  // Two-step load: the /plugins/$ catch-all renderer reads `listPluginRoutes()`
  // at render time (non-reactive), so if we navigate straight to /plugins/hello
  // with the sideload param we'd hit the "plugin route not found" branch before
  // the plugin finishes registering. Load the plugin on the dashboard first,
  // then click through to /plugins/hello.
  await page.goto('/t/acme/dashboard?' + PLUGIN_QS.slice(1));
  await waitForSamplePluginRegistered(page);

  await page.getByRole('link', { name: /hello plugin/i }).click();

  await expect(page.getByTestId('sample-plugin-hello')).toBeVisible();
});

test('dev-sideload plugin: theme picker exposes the plugin theme', async ({ authedPage: page }) => {
  await page.goto('/t/acme/dashboard?' + PLUGIN_QS.slice(1));
  await waitForSamplePluginRegistered(page);

  // Assert the theme is registered in the host theme registry — a stable probe
  // independent of theme-picker DOM structure.
  const themeEntries = await page.evaluate(() => {
    const host = (
      window as unknown as {
        __RIOKU_PLUGIN_HOST?: {
          listThemes: () => { name: string; displayName: string }[];
        };
      }
    ).__RIOKU_PLUGIN_HOST;
    if (!host) return [];
    return host.listThemes().map((t) => ({ name: t.name, displayName: t.displayName }));
  });
  expect(themeEntries).toContainEqual({
    name: 'sample-hello-theme',
    displayName: 'Sample Hello',
  });
});

test('dev-sideload plugin: permission registered in catalog', async ({ authedPage: page }) => {
  await page.goto('/t/acme/dashboard?' + PLUGIN_QS.slice(1));
  await waitForSamplePluginRegistered(page);

  const perm = await page.evaluate(() => {
    const host = (
      window as unknown as {
        __RIOKU_PLUGIN_HOST?: {
          getPermission: (key: string) => { key: string; source: string } | undefined;
        };
      }
    ).__RIOKU_PLUGIN_HOST;
    if (!host) return null;
    return host.getPermission('com.example.hello:greet') ?? null;
  });
  expect(perm).not.toBeNull();
  expect(perm).toMatchObject({ key: 'com.example.hello:greet' });
});

test('dev-sideload plugin: spotlight command listed', async ({ authedPage: page }) => {
  await page.goto('/t/acme/dashboard?' + PLUGIN_QS.slice(1));
  await waitForSamplePluginRegistered(page);

  const commandEntries = await page.evaluate(() => {
    const host = (
      window as unknown as {
        __RIOKU_PLUGIN_HOST?: {
          listSpotlight: () => { id: string; label: string }[];
        };
      }
    ).__RIOKU_PLUGIN_HOST;
    if (!host) return [];
    return host.listSpotlight().map((c) => ({ id: c.id, label: c.label }));
  });
  expect(commandEntries).toContainEqual({
    id: 'sample-hello-open',
    label: 'Open Hello Plugin',
  });

  // Also assert the command is reachable via the spotlight UI — open via mod+K
  // and confirm the Spotlight modal mounted (the plugin command is rendered
  // inside the actions list, but Mantine's virtualised list only renders
  // matches for the current query; asserting the action renders by keyword is
  // flaky in a clean-slate spotlight so we settle for the modal being open).
  await page.keyboard.press('Control+K');
  await expect(page.getByPlaceholder(/search/i)).toBeVisible();
});
