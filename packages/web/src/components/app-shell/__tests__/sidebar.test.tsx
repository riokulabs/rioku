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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerNavEntries, _resetNavRegistry } from '../nav-registry';
import {
  IconBook,
  IconBrain,
  IconBadge,
  IconBell,
  IconDevices,
  IconFileText,
  IconGauge,
  IconHistory,
  IconKey,
  IconPlug,
  IconRobot,
  IconRoute,
  IconScale,
  IconServer,
  IconShield,
  IconStack,
  IconTool,
  IconTopologyRing,
  IconRouter,
  IconUsers,
} from '@tabler/icons-react';

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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '../sidebar';

// Deterministic nav entry list matching the static nav-tree definitions.
// Must be kept in sync with the feature nav.ts files.
const ALL_NAV_ENTRIES = [
  // apim
  {
    id: 'services',
    label: 'Services',
    icon: IconServer,
    suffix: 'services',
    group: 'apim' as const,
    order: 10,
  },
  {
    id: 'routes',
    label: 'Routes',
    icon: IconRoute,
    suffix: 'routes',
    group: 'apim' as const,
    order: 20,
  },
  {
    id: 'policies',
    label: 'Policies',
    icon: IconShield,
    suffix: 'policies',
    group: 'apim' as const,
    order: 30,
  },
  {
    id: 'middlewares',
    label: 'Middlewares',
    icon: IconStack,
    suffix: 'middlewares',
    group: 'apim' as const,
    order: 40,
  },
  {
    id: 'api-explorer',
    label: 'API Explorer',
    icon: IconBook,
    suffix: 'api-explorer',
    group: 'apim' as const,
    order: 50,
  },
  // ai
  {
    id: 'ai-providers',
    label: 'Providers',
    icon: IconBrain,
    suffix: 'ai/providers',
    group: 'ai' as const,
    order: 10,
  },
  {
    id: 'ai-agents',
    label: 'Agents',
    icon: IconRobot,
    suffix: 'ai/agents',
    group: 'ai' as const,
    order: 20,
  },
  {
    id: 'ai-tools',
    label: 'Tools',
    icon: IconTool,
    suffix: 'ai/tools',
    group: 'ai' as const,
    order: 30,
  },
  {
    id: 'ai-tool-routing',
    label: 'Tool routing',
    icon: IconRouter,
    suffix: 'ai/tool-routing',
    group: 'ai' as const,
    order: 40,
  },
  {
    id: 'ai-rate-limits',
    label: 'Rate limits',
    icon: IconGauge,
    suffix: 'ai/rate-limits',
    group: 'ai' as const,
    order: 50,
  },
  {
    id: 'ai-traces',
    label: 'Traces',
    icon: IconHistory,
    suffix: 'ai/traces',
    group: 'ai' as const,
    order: 60,
  },
  {
    id: 'ai-mcp-servers',
    label: 'MCP servers',
    icon: IconServer,
    suffix: 'ai/mcp-servers',
    group: 'ai' as const,
    order: 70,
  },
  {
    id: 'ai-access-policies',
    label: 'Access policies',
    icon: IconShield,
    suffix: 'security/access-policies',
    group: 'ai' as const,
    order: 80,
  },
  // security
  {
    id: 'security-users',
    label: 'Users',
    icon: IconUsers,
    suffix: 'security/users',
    group: 'security' as const,
    order: 10,
  },
  {
    id: 'security-roles',
    label: 'Roles',
    icon: IconBadge,
    suffix: 'security/roles',
    group: 'security' as const,
    order: 20,
  },
  {
    id: 'security-api-keys',
    label: 'API keys',
    icon: IconKey,
    suffix: 'security/api-keys',
    group: 'security' as const,
    order: 30,
  },
  {
    id: 'security-rbac-policies',
    label: 'RBAC policies',
    icon: IconScale,
    suffix: 'security/rbac-policies',
    group: 'security' as const,
    order: 40,
  },
  {
    id: 'security-sessions',
    label: 'Sessions',
    icon: IconDevices,
    suffix: 'security/sessions',
    group: 'security' as const,
    order: 50,
  },
  {
    id: 'security-audit',
    label: 'Audit',
    icon: IconFileText,
    suffix: 'security/audit',
    group: 'security' as const,
    order: 60,
  },
  // system
  {
    id: 'cluster',
    label: 'Cluster',
    icon: IconTopologyRing,
    suffix: 'cluster',
    group: 'system' as const,
    order: 10,
  },
  {
    id: 'plugins',
    label: 'Plugins',
    icon: IconPlug,
    suffix: 'plugins',
    group: 'system' as const,
    order: 20,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: IconBell,
    suffix: 'notifications',
    group: 'system' as const,
    order: 30,
  },
];

beforeEach(() => {
  _resetNavRegistry();
  registerNavEntries(...ALL_NAV_ENTRIES);
});

afterEach(() => {
  _resetNavRegistry();
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
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
    expect(ids).toEqual(['dashboard', 'sites', 'analytics', 'apim', 'ai', 'security', 'system']);
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

describe('Sidebar collapse behavior', () => {
  it('shows icons only (no labels) in the rail when collapsed', () => {
    currentPath = '/t/acme/ai/providers';
    wrap(<Sidebar collapsed onToggleCollapsed={() => {}} />);
    // Rail is still visible
    expect(document.querySelectorAll('[data-testid^="rail-section-"]')).toHaveLength(7);
    // Section labels are NOT rendered inside rail entries when collapsed
    const dashboardEntry = document.querySelector('[data-testid="rail-section-dashboard"]');
    expect(dashboardEntry?.textContent).toBe('');
    // Sub menu (panel) is still open because AI has children
    expect(screen.getByText('Providers')).toBeInTheDocument();
  });

  it('shows icons + labels in the rail when expanded', () => {
    currentPath = '/t/acme/ai/providers';
    wrap(<Sidebar collapsed={false} onToggleCollapsed={() => {}} />);
    expect(document.querySelectorAll('[data-testid^="rail-section-"]')).toHaveLength(7);
    // Each rail entry now carries its label text
    const dashboardEntry = document.querySelector('[data-testid="rail-section-dashboard"]');
    expect(dashboardEntry?.textContent).toContain('Dashboard');
    const aiEntry = document.querySelector('[data-testid="rail-section-ai"]');
    expect(aiEntry?.textContent).toContain('AI');
    // Sub menu still open
    expect(screen.getByText('Providers')).toBeInTheDocument();
  });

  it('renders the collapse toggle in the main nav (rail), so it shows even when no sub-menu is present', () => {
    // Dashboard has no children → no panel renders. If the toggle appears
    // here, it must be living in the rail (the only visible surface).
    currentPath = '/t/acme/dashboard';
    wrap(<Sidebar collapsed onToggleCollapsed={() => {}} />);
    const toggle = document.querySelector('[data-testid="sidebar-collapse-toggle"]');
    expect(toggle).not.toBeNull();
  });

  it('does not render a sub-menu panel for sections without children', () => {
    currentPath = '/t/acme/dashboard';
    wrap(<Sidebar collapsed={false} onToggleCollapsed={() => {}} />);
    expect(document.querySelectorAll('[data-testid^="rail-section-"]')).toHaveLength(7);
    // Dashboard has no children — sub-menu NavLinks from other sections
    // should not appear, and neither should a panel header for children.
    expect(screen.queryByText('Providers')).toBeNull();
    expect(screen.queryByText('Services')).toBeNull();
    expect(screen.queryByText('Insights')).toBeNull();
  });
});
