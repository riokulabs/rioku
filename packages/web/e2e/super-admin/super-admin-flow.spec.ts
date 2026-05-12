/**
 * E2E smoke — super-admin flow (Plan 11 close-out).
 *
 * Logs in as the seeded super-admin (Derrick), walks the three super-admin
 * surfaces, and asserts each renders data delivered by intercepted
 * `/api/v1/admin/*` responses. The spec is sandbox-aware: it stubs the daemon
 * via `page.route(...)` so it runs against the Vite dev server without
 * requiring the daemon to be online. When the daemon ships hash-chained admin
 * audit, the verify-chain assertion below will exercise real chain data.
 *
 * @isolated — each test installs its own route handlers and never touches
 * mock-store priming, so suite ordering is irrelevant.
 *
 * Plan 11 / Task 7 (close-out gauntlet)
 */
import { test, expect } from '../fixtures/auth';
import { hashEntryForTest, type ChainedEntry } from './hash-chain-helpers';

// ─── Per-test fixtures (intercepted on the Vite dev server) ───────────────────

const SAMPLE_TENANTS = [
  {
    id: 'tenant-acme',
    slug: 'acme',
    name: 'Acme Corp',
    plan: 'enterprise',
    urlMode: 'subdomain',
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-02T12:00:00.000Z',
  },
  {
    id: 'tenant-beta',
    slug: 'beta',
    name: 'Beta Industries',
    plan: 'pro',
    urlMode: 'path',
    createdAt: '2026-02-01T12:00:00.000Z',
    updatedAt: '2026-02-02T12:00:00.000Z',
  },
  {
    id: 'tenant-gamma',
    slug: 'gamma',
    name: 'Gamma Co',
    plan: 'community',
    urlMode: 'path',
    createdAt: '2026-03-01T12:00:00.000Z',
    updatedAt: '2026-03-02T12:00:00.000Z',
  },
];

const SAMPLE_USERS = [
  { id: 'user-1', username: 'alice', status: 'active' },
  { id: 'user-2', username: 'bob', status: 'active' },
  { id: 'user-3', username: 'charlie', status: 'disabled' },
];

test.describe('super-admin: tenant inventory', () => {
  test('lists tenants, filters by plan, searches by slug, opens detail drawer', async ({
    authedPage: page,
  }) => {
    await page.route('**/api/v1/admin/tenants', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: SAMPLE_TENANTS, total: SAMPLE_TENANTS.length }),
      });
    });

    await page.goto('/admin/tenants');

    // All three seeded tenants render. Scope assertions to the data table to
    // avoid colliding with "acme" elsewhere in the AdminLayout (tenant
    // switcher etc.).
    await expect(page.getByRole('heading', { name: /^tenants$/i })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table.getByRole('cell', { name: 'Acme Corp' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Beta Industries' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Gamma Co' })).toBeVisible();

    // Filter by plan = enterprise → only acme (Acme Corp) remains.
    const planFilter = page.getByTestId('plan-filter');
    await planFilter.click();
    await page.getByRole('option', { name: /^Enterprise$/ }).click();
    await expect(table.getByRole('cell', { name: 'Acme Corp' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Beta Industries' })).toHaveCount(0);
    await expect(table.getByRole('cell', { name: 'Gamma Co' })).toHaveCount(0);

    // Reset filter, then search by slug "beta".
    await planFilter.click();
    await page.getByRole('option', { name: /^All plans$/ }).click();
    await page.getByTestId('tenant-search').fill('beta');
    await expect(table.getByRole('cell', { name: 'Beta Industries' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Acme Corp' })).toHaveCount(0);

    // Click View on the beta row → detail drawer opens with quick info + Open in tenant.
    await page.getByRole('button', { name: /^view beta$/i }).click();
    await expect(page.getByTestId('open-in-tenant-btn')).toBeVisible();
  });
});

test.describe('super-admin: cross-tenant users', () => {
  test('lists users delivered by /admin/users', async ({ authedPage: page }) => {
    await page.route('**/api/v1/admin/users', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: SAMPLE_USERS, total: SAMPLE_USERS.length }),
      });
    });

    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: /^all users$/i })).toBeVisible();
    await expect(page.getByText('alice')).toBeVisible();
    await expect(page.getByText('bob')).toBeVisible();
    await expect(page.getByText('charlie')).toBeVisible();

    // Open the detail drawer.
    await page.getByTestId('user-name-cell').first().click();
    // The drawer renders the username and ID labels.
    await expect(page.getByText(/^username$/i).first()).toBeVisible();
  });
});

test.describe('super-admin: admin audit log', () => {
  test('renders audit entries, opens detail drawer, verifies hash chain', async ({
    authedPage: page,
  }) => {
    // Build a real two-link hash chain so the verify button can succeed.
    const chain: ChainedEntry[] = await buildSampleChain();

    await page.route('**/api/v1/admin/audit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: chain, total: chain.length }),
      });
    });

    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: /^admin audit log$/i })).toBeVisible();

    // Both chained entries render in the table.
    await expect(page.getByText('tenant:create')).toBeVisible();
    await expect(page.getByText('tenant:update')).toBeVisible();

    // Open the detail drawer for the newest entry.
    const detailButtons = page.getByRole('button', { name: /view details for/i });
    await expect(detailButtons.first()).toBeVisible();
    await detailButtons.first().click();
    // Drawer shows Overview / Diff / Hash chain tabs.
    await expect(page.getByRole('tab', { name: /^overview$/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^diff$/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^hash chain$/i })).toBeVisible();

    // Close the drawer (Esc) and verify the chain.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^verify chain$/i }).click();
    await expect(page.getByTestId('chain-verified-badge')).toBeVisible();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildSampleChain(): Promise<ChainedEntry[]> {
  // Two chained entries with valid SHA-256 linkage. Hashes are computed in-test
  // so the chain's integrity is real, not a placeholder.
  const e1Base: Omit<ChainedEntry, 'hash'> = {
    id: 'admin-audit-0001',
    kind: 'admin',
    tenant_id: null,
    actor_id: 'user-derrick',
    action: 'tenant:create',
    resource_type: 'tenant',
    resource_id: 'tenant-acme',
    outcome: 'success',
    at: '2026-04-01T00:00:00.000Z',
    tier: 'write',
    prev_hash: '',
  };
  const h1 = await hashEntryForTest(e1Base);

  const e2Base: Omit<ChainedEntry, 'hash'> = {
    id: 'admin-audit-0002',
    kind: 'admin',
    tenant_id: null,
    actor_id: 'user-derrick',
    action: 'tenant:update',
    resource_type: 'tenant',
    resource_id: 'tenant-acme',
    outcome: 'success',
    at: '2026-04-02T00:00:00.000Z',
    tier: 'write',
    prev_hash: h1,
  };
  const h2 = await hashEntryForTest(e2Base);

  return [
    { ...e1Base, hash: h1 },
    { ...e2Base, hash: h2 },
  ];
}
