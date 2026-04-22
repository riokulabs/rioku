/**
 * Badge consistency screenshot capture.
 * Run with: node_modules/.bin/playwright test e2e/visual/badges.spec.ts --project=chromium
 *
 * Captures key pages in light and dark mode to verify badge legibility.
 * Screenshots are saved to e2e/screenshots/badges/ (gitignored).
 */
import { test } from '../fixtures/auth';

const PAGES = [
  { name: 'services-list',  url: '/t/acme-corp/services' },
  { name: 'sites-list',     url: '/t/acme-corp/sites' },
  { name: 'audit-list',     url: '/t/acme-corp/security/audit' },
  { name: 'api-keys-list',  url: '/t/acme-corp/security/api-keys' },
  { name: 'sessions-list',  url: '/t/acme-corp/security/sessions' },
  { name: 'users-list',     url: '/t/acme-corp/security/users' },
  { name: 'ai-traces-list', url: '/t/acme-corp/ai/traces' },
  { name: 'plugins-list',   url: '/t/acme-corp/plugins/installed' },
  { name: 'notif-log',      url: '/t/acme-corp/notification-log' },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const pg of PAGES) {
    test(`badge-screenshot: ${pg.name} (${scheme})`, async ({ authedPage }) => {
      await authedPage.emulateMedia({ colorScheme: scheme });
      await authedPage.goto(pg.url, { waitUntil: 'networkidle' });
      await authedPage.waitForSelector('[data-mantine-color-scheme]', { timeout: 10000 });
      await authedPage.screenshot({
        path: `e2e/screenshots/badges/${pg.name}-${scheme}.png`,
        fullPage: false,
      });
    });
  }
}
