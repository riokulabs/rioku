/**
 * Tests for <Sidebar> — verifies the two-pane IA: a 60px rail carrying the
 * 7 top-level sections, plus a section panel that renders only the
 * children of the currently-active section.
 *
 *   - Rail has exactly 7 sections (Dashboard / Sites / Analytics / APIM /
 *     AI / Security / System). Settings is intentionally excluded from the
 *     rail — it lives in the user-card menu.
 *   - When the user is on an APIM path, the panel renders Services /
 *     Routes / Policies / Middlewares / API Explorer.
 *   - When the user is on an AI path, the panel renders the 8 AI entries
 *     including Access policies.
 *   - Rail section links point to each section's `defaultRoute`.
 */
import { describe, it, expect, vi } from 'vitest';

// Hoisted mutable path so different tests can change the "current URL".
let currentPath = '/t/acme/services';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: currentPath } }),
  useLocation: () => ({ pathname: currentPath }),
  useParams: () => ({ tenant: 'acme' }),
  Link: ({
    children,
    to,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    [k: string]: unknown;
  }) => (
    <span data-link-to={to ?? ''} {...rest}>
      {children}
    </span>
  ),
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

function railHrefs(): string[] {
  const carriers = document.querySelectorAll('[data-testid^="rail-section-"]');
  return Array.from(carriers).map((el) => el.getAttribute('data-link-to') ?? '');
}

describe('Sidebar rail', () => {
  it('renders exactly the 7 top-level rail sections', () => {
    currentPath = '/t/acme/dashboard';
    wrap(<Sidebar />);
    const rails = document.querySelectorAll('[data-testid^="rail-section-"]');
    expect(rails).toHaveLength(7);
    const ids = Array.from(rails).map((el) =>
      el.getAttribute('data-testid')?.replace('rail-section-', ''),
    );
    expect(ids).toEqual([
      'dashboard',
      'sites',
      'analytics',
      'apim',
      'ai',
      'security',
      'system',
    ]);
  });

  it('rail icons link to each section default route', () => {
    currentPath = '/t/acme/dashboard';
    wrap(<Sidebar />);
    const hrefs = railHrefs();
    expect(hrefs).toContain('/t/acme/dashboard');
    expect(hrefs).toContain('/t/acme/sites');
    expect(hrefs).toContain('/t/acme/dashboards');
    expect(hrefs).toContain('/t/acme/services');
    expect(hrefs).toContain('/t/acme/ai/providers');
    expect(hrefs).toContain('/t/acme/security/users');
    expect(hrefs).toContain('/t/acme/cluster');
  });

  it('does not expose Settings in the rail', () => {
    currentPath = '/t/acme/dashboard';
    wrap(<Sidebar />);
    expect(document.querySelector('[data-testid="rail-section-settings"]')).toBeNull();
  });
});

describe('Sidebar panel — APIM section', () => {
  it('renders all API management entries when on /services', () => {
    currentPath = '/t/acme/services';
    wrap(<Sidebar />);
    for (const label of ['Services', 'Routes', 'Policies', 'Middlewares', 'API Explorer']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('APIM entries point to expected paths', () => {
    currentPath = '/t/acme/services';
    wrap(<Sidebar />);
    const carriers = document.querySelectorAll('[data-link-to]');
    const byLabel = (label: string) =>
      Array.from(carriers).find((el) => el.textContent.trim() === label);
    expect(byLabel('Services')?.getAttribute('data-link-to')).toBe('/t/acme/services');
    expect(byLabel('Routes')?.getAttribute('data-link-to')).toBe('/t/acme/routes');
    expect(byLabel('Policies')?.getAttribute('data-link-to')).toBe('/t/acme/policies');
    expect(byLabel('Middlewares')?.getAttribute('data-link-to')).toBe('/t/acme/middlewares');
    expect(byLabel('API Explorer')?.getAttribute('data-link-to')).toBe('/t/acme/api-explorer');
  });
});

describe('Sidebar panel — AI section', () => {
  it('renders all eight AI entries with expected hrefs including Access policies', () => {
    currentPath = '/t/acme/ai/providers';
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
      ['Access policies', '/t/acme/security/access-policies'],
    ];
    for (const [label, href] of expectations) {
      const entry = byLabel(label);
      expect(entry, `missing AI entry ${label}`).toBeDefined();
      expect(entry?.getAttribute('data-link-to')).toBe(href);
    }
  });

  it('Navigating to /security/access-policies keeps the AI panel open (not Security)', () => {
    currentPath = '/t/acme/security/access-policies';
    wrap(<Sidebar />);
    // AI panel shows Providers, Agents, etc.
    expect(screen.getByText('Providers')).toBeInTheDocument();
    // Security-specific items should NOT be visible (different section active).
    expect(screen.queryByText('Users')).toBeNull();
  });
});

describe('Sidebar panel — Analytics section', () => {
  it('shows Insights entry linking to /dashboards', () => {
    currentPath = '/t/acme/dashboards';
    wrap(<Sidebar />);
    const carriers = document.querySelectorAll('[data-link-to]');
    const entry = Array.from(carriers).find((el) => el.textContent.trim() === 'Insights');
    expect(entry).toBeDefined();
    expect(entry?.getAttribute('data-link-to')).toBe('/t/acme/dashboards');
  });
});
