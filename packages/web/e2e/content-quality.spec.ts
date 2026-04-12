import { authedTest as test, expect } from './fixtures';

/**
 * Content quality tests: verify every page in the app renders meaningful
 * content without error boundaries, raw i18n keys, raw enum values, or
 * unresolved template strings.
 */

const ALL_PAGES = [
  { name: 'Dashboard', path: '/' },
  { name: 'Routes', path: '/config/routes' },
  { name: 'Services', path: '/config/services' },
  { name: 'Policies', path: '/config/policies' },
  { name: 'Route Create', path: '/config/routes/create' },
  { name: 'Service Create', path: '/config/services/create' },
  { name: 'Policy Create', path: '/config/policies/create' },
  { name: 'Traffic Live', path: '/traffic/live' },
  { name: 'Traffic Analytics', path: '/traffic/analytics' },
  { name: 'Traffic AI', path: '/traffic/ai' },
  { name: 'Cluster', path: '/cluster' },
  { name: 'Plugins', path: '/plugins' },
  { name: 'Certificates', path: '/certificates' },
  { name: 'Security Users', path: '/security/users' },
  { name: 'Security API Keys', path: '/security/api-keys' },
  { name: 'Security Access Policies', path: '/security/access-policies' },
  { name: 'Audit', path: '/audit' },
  { name: 'Settings General', path: '/settings/general' },
  { name: 'Settings Network', path: '/settings/network' },
  { name: 'Settings TLS', path: '/settings/tls' },
  { name: 'Settings Observability', path: '/settings/observability' },
  { name: 'Settings Authentication', path: '/settings/authentication' },
  { name: 'Settings Config Store', path: '/settings/config-store' },
  { name: 'Settings PKI', path: '/settings/pki' },
  { name: 'Settings Danger Zone', path: '/settings/danger-zone' },
  { name: 'Settings Profile', path: '/settings/profile' },
];

// Patterns that indicate raw i18n keys leaked into the UI
const RAW_I18N_PATTERNS = [
  /\blist\.createKey\b/,
  /\bdetail\.backToList\b/,
  /\bmessages\.\w+/,
  /\bnav\.\w+/,
  /\btitle\b.*\bsubtitle\b/,
  /\bform\.\w+\.\w+/,
  /\bempty\.\w+/,
  /\btable\.\w+/,
  /\bactions\.\w+/,
  /\bstats\.\w+/,
  /\bcharts\.\w+/,
];

// Raw protobuf enum values that should be human-readable
const RAW_ENUM_PATTERNS = [
  /POLICY_TYPE_\w+/,
  /LB_POLICY_\w+/,
  /TLS_MODE_\w+/,
  /TYPE_PREFIX\b/,
  /TYPE_EXACT\b/,
  /TYPE_REGEXP\b/,
];

// Unresolved template strings
const TEMPLATE_PATTERN = /\{\{[^}]+\}\}/;

test.describe('Content quality', () => {
  for (const pageInfo of ALL_PAGES) {
    test(`${pageInfo.name} (${pageInfo.path}) — no error boundary`, async ({ page }) => {
      await page.goto(pageInfo.path);
      await page.waitForLoadState('domcontentloaded');
      // Give the SPA a moment to render
      await page.waitForTimeout(1000);

      const errorBoundary = page.getByText('Something went wrong');
      await expect(errorBoundary).not.toBeVisible();
    });

    test(`${pageInfo.name} (${pageInfo.path}) — no raw i18n keys`, async ({ page }) => {
      await page.goto(pageInfo.path);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const bodyText = await page.locator('body').innerText();

      for (const pattern of RAW_I18N_PATTERNS) {
        // Only flag if the pattern appears as visible text (not in data attributes)
        const matches = bodyText.match(pattern);
        if (matches) {
          // Some legitimate content might match (e.g., code blocks); check it's
          // not inside a code/pre element
          const inCodeBlock = await page.evaluate((matchText) => {
            const codeEls = document.querySelectorAll('code, pre, [data-testid]');
            for (const el of codeEls) {
              if (el.textContent?.includes(matchText)) return true;
            }
            return false;
          }, matches[0]);

          if (!inCodeBlock) {
            expect.soft(matches, `Raw i18n key found on ${pageInfo.name}: ${matches[0]}`).toBeNull();
          }
        }
      }
    });

    test(`${pageInfo.name} (${pageInfo.path}) — no raw enum values`, async ({ page }) => {
      await page.goto(pageInfo.path);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const bodyText = await page.locator('body').innerText();

      for (const pattern of RAW_ENUM_PATTERNS) {
        const matches = bodyText.match(pattern);
        expect.soft(matches, `Raw enum value on ${pageInfo.name}: ${matches?.[0]}`).toBeNull();
      }
    });

    test(`${pageInfo.name} (${pageInfo.path}) — no unresolved templates`, async ({ page }) => {
      await page.goto(pageInfo.path);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const bodyText = await page.locator('body').innerText();
      const matches = bodyText.match(TEMPLATE_PATTERN);
      expect.soft(matches, `Unresolved template on ${pageInfo.name}: ${matches?.[0]}`).toBeNull();
    });

    test(`${pageInfo.name} (${pageInfo.path}) — has meaningful content`, async ({ page }) => {
      await page.goto(pageInfo.path);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText.trim().length).toBeGreaterThan(50);
    });
  }
});
