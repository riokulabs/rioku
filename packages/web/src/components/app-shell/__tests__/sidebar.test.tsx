/**
 * Tests for <Sidebar> — verifies the top-level navigation structure per Plan 2
 * Task 2c.23:
 *
 *   - "Sites" entry lives under General (top-level, not inside API management).
 *   - "API management" group contains Services, Routes, Policies,
 *     Middlewares, and API Explorer.
 *   - All entries render with their expected href pattern.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/t/acme/dashboard' } }),
  Link: ({
    children,
    to,
  }: {
    children?: React.ReactNode;
    to?: string;
  }) => <span data-link-to={to ?? ''}>{children}</span>,
}));

vi.mock('@/hooks/use-sidebar-entries', () => ({
  useSidebarEntries: () => [],
}));

vi.mock('../sidebar-footer', () => ({
  SidebarFooter: () => <div data-testid="sidebar-footer" />,
}));

import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Sidebar } from '../sidebar';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('Sidebar', () => {
  it('renders Sites as a top-level entry', () => {
    wrap(<Sidebar />);
    const sitesLink = screen.getByText('Sites').closest('a, span');
    expect(sitesLink).toBeInTheDocument();
    // Confirm the Sites href matches the tenant-prefixed pattern.
    const hrefCarriers = document.querySelectorAll('[data-link-to]');
    const siteEntry = Array.from(hrefCarriers).find((el) =>
      el.textContent.includes('Sites'),
    );
    expect(siteEntry?.getAttribute('data-link-to')).toBe('/t/acme/sites');
  });

  it('renders all API management entries', () => {
    wrap(<Sidebar />);
    for (const label of [
      'Services',
      'Routes',
      'Policies',
      'Middlewares',
      'API Explorer',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('API management entries point to the expected paths', () => {
    wrap(<Sidebar />);
    const carriers = document.querySelectorAll('[data-link-to]');
    const byLabel = (label: string) =>
      Array.from(carriers).find((el) => el.textContent.trim() === label);
    expect(byLabel('Services')?.getAttribute('data-link-to')).toBe(
      '/t/acme/services',
    );
    expect(byLabel('Routes')?.getAttribute('data-link-to')).toBe(
      '/t/acme/routes',
    );
    expect(byLabel('Policies')?.getAttribute('data-link-to')).toBe(
      '/t/acme/policies',
    );
    expect(byLabel('Middlewares')?.getAttribute('data-link-to')).toBe(
      '/t/acme/middlewares',
    );
    expect(byLabel('API Explorer')?.getAttribute('data-link-to')).toBe(
      '/t/acme/api-explorer',
    );
  });

  it('renders all seven AI entries with expected hrefs', () => {
    wrap(<Sidebar />);
    const carriers = document.querySelectorAll('[data-link-to]');
    const byLabel = (label: string) =>
      Array.from(carriers).find((el) => el.textContent.trim() === label);
    const expectations: [string, string][] = [
      ['Providers', '/t/acme/ai/providers'],
      ['Agents', '/t/acme/ai/agents'],
      ['Tools', '/t/acme/ai/tools'],
      ['Tool routing', '/t/acme/ai/tool-routing'],
      ['Rate limits', '/t/acme/ai/rate-limits'],
      ['Traces', '/t/acme/ai/traces'],
      ['MCP servers', '/t/acme/ai/mcp-servers'],
    ];
    for (const [label, href] of expectations) {
      const entry = byLabel(label);
      expect(entry, `missing AI entry ${label}`).toBeDefined();
      expect(entry?.getAttribute('data-link-to')).toBe(href);
    }
  });
});
